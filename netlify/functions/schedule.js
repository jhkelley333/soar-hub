// netlify/functions/schedule.js
//
// Schedule module v1 backend — SOAR-native calendar events. Mirrors the
// auth + store-scoping model of cash-management.js / employee-actions.js:
// validate the Supabase JWT with the service-role key, look up the caller's
// profile, and gate visibility + writes on the org tree the caller can see.
//
// Actions:
//   GET  ?action=list&from=&to=  -> events whose org node is in the caller's
//                                   scope, overlapping [from, to)
//   GET  ?action=stores          -> the caller's visible stores (grouped by
//                                   district) for the event picker + tree filter
//   POST ?action=create          -> create a native event in scope
//   POST ?action=update          -> edit a native event in scope
//   POST ?action=delete          -> delete a native event in scope

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Roles that may create/edit events. Store leaders up — each within their scope.
const WRITE_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
// Org-wide readers/writers see (and can pin org-wide) events.
const ORG_WIDE = new Set(["admin", "coo", "vp"]);

const EVENT_TYPES = new Set([
  "store_visit", "audit", "renovation", "training",
  "manager_meeting", "pto", "delivery", "deadline", "other",
]);
const SCOPE_TYPES = new Set(["store", "district", "area", "region", "org"]);
const RECURRENCE_TYPES = new Set(["none", "daily", "weekly", "biweekly", "monthly"]);
const DAY_MS = 86400000;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("schedule env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active, primary_store_id")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function unwrap(result) {
  if (result && typeof result === "object" && "status" in result && "error" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}
const sanitize = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const displayName = (p) => p.preferred_name || p.full_name || p.email;

// ----------------------------------------------------------------------------
// Scope — the caller's visible stores + the district/area/region ids they roll
// up into, so an event pinned to any of those nodes is visible to the caller.
// Mirrors cash-management.js storeRowsForUser.
// ----------------------------------------------------------------------------
async function resolveScope(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  let storeRows;
  let all = false;
  // The viewer's "home" node — the broadest org node they own explicitly.
  // Drives the "YOU" badge on the org tree. Org-wide roles sit at "org".
  let primaryScope = { scope_type: "org", scope_id: null };
  if (ORG_WIDE.has(role) || role === "accounting" || role === "payroll") {
    const { data } = await supa
      .from("stores").select("id, number, name, district_id").eq("is_active", true).order("number").limit(2000);
    storeRows = data || [];
    all = true;
  } else {
    const { data: scopes } = await supa
      .from("user_scopes").select("scope_type, scope_id").eq("user_id", profile.id);
    // Broadest explicit scope wins (region > area > district > store).
    const BREADTH = { region: 4, area: 3, district: 2, store: 1 };
    for (const s of scopes || []) {
      if ((BREADTH[s.scope_type] || 0) > (BREADTH[primaryScope.scope_type] || 0)) {
        primaryScope = { scope_type: s.scope_type, scope_id: s.scope_id };
      }
    }
    if (primaryScope.scope_type === "org") primaryScope = { scope_type: null, scope_id: null };
    const storeIds = new Set(scopes?.filter((s) => s.scope_type === "store").map((s) => s.scope_id) || []);
    const districtIds = new Set(scopes?.filter((s) => s.scope_type === "district").map((s) => s.scope_id) || []);
    const areaIds = new Set(scopes?.filter((s) => s.scope_type === "area").map((s) => s.scope_id) || []);
    const regionIds = scopes?.filter((s) => s.scope_type === "region").map((s) => s.scope_id) || [];
    if (regionIds.length) {
      const { data } = await supa.from("areas").select("id").in("region_id", regionIds);
      for (const a of data || []) areaIds.add(a.id);
    }
    if (areaIds.size) {
      const { data } = await supa.from("districts").select("id").in("area_id", Array.from(areaIds));
      for (const d of data || []) districtIds.add(d.id);
    }
    if (districtIds.size) {
      const { data } = await supa.from("stores").select("id").in("district_id", Array.from(districtIds));
      for (const s of data || []) storeIds.add(s.id);
    }
    storeRows = [];
    if (storeIds.size) {
      const { data } = await supa
        .from("stores").select("id, number, name, district_id").in("id", Array.from(storeIds))
        .eq("is_active", true).order("number");
      storeRows = data || [];
    }
  }

  // Roll the visible stores up to their district / area / region ids.
  const storeIdSet = new Set(storeRows.map((s) => s.id));
  const storeNumberSet = new Set(storeRows.map((s) => String(s.number)));
  const districtIdSet = new Set(storeRows.map((s) => s.district_id).filter(Boolean));
  const areaIdSet = new Set();
  const regionIdSet = new Set();
  if (districtIdSet.size) {
    const { data: dists } = await supa
      .from("districts").select("id, name, code, area_id").in("id", Array.from(districtIdSet));
    const districtById = new Map((dists || []).map((d) => [d.id, d]));
    for (const d of dists || []) if (d.area_id) areaIdSet.add(d.area_id);
    let areas = [];
    if (areaIdSet.size) {
      const { data } = await supa.from("areas").select("id, name, region_id").in("id", Array.from(areaIdSet));
      areas = data || [];
      for (const a of areas) if (a.region_id) regionIdSet.add(a.region_id);
    }
    const areaById = new Map(areas.map((a) => [a.id, a]));
    let regionById = new Map();
    if (regionIdSet.size) {
      const { data: regs } = await supa.from("regions").select("id, name, code").in("id", Array.from(regionIdSet));
      regionById = new Map((regs || []).map((r) => [r.id, r]));
    }
    return { all, storeRows, storeIdSet, storeNumberSet, districtIdSet, areaIdSet, regionIdSet, districtById, areaById, regionById, primaryScope };
  }
  return { all, storeRows, storeIdSet, storeNumberSet, districtIdSet, areaIdSet, regionIdSet, districtById: new Map(), areaById: new Map(), regionById: new Map(), primaryScope };
}

// Is the given (scope_type, scope_id) node within the caller's scope?
function nodeInScope(scope, scopeType, scopeId) {
  if (scope.all) return true;
  switch (scopeType) {
    case "org": return true; // org-wide events are visible to everyone in scope
    case "store": return scope.storeIdSet.has(scopeId);
    case "district": return scope.districtIdSet.has(scopeId);
    case "area": return scope.areaIdSet.has(scopeId);
    case "region": return scope.regionIdSet.has(scopeId);
    default: return false;
  }
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------
function eventCard(e) {
  return {
    id: e.id,
    source: "soar",
    title: e.title,
    type: e.type,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    all_day: e.all_day,
    scope_type: e.scope_type,
    scope_id: e.scope_id,
    store_number: e.store_number,
    notes: e.notes,
    color: e.color,
    created_by_name: e.created_by_name,
    recurrence: e.recurrence || "none",
    recurrence_until: e.recurrence_until || null,
  };
}

// The i-th occurrence of a recurring master, computed in UTC so the stored
// wall-clock is preserved (events are stored as UTC instants of a local time).
function nthOccurrence(start, recurrence, i) {
  const y = start.getUTCFullYear(), m = start.getUTCMonth(), d = start.getUTCDate();
  const h = start.getUTCHours(), min = start.getUTCMinutes(), s = start.getUTCSeconds();
  if (recurrence === "daily") return new Date(Date.UTC(y, m, d + i, h, min, s));
  if (recurrence === "weekly") return new Date(Date.UTC(y, m, d + i * 7, h, min, s));
  if (recurrence === "biweekly") return new Date(Date.UTC(y, m, d + i * 14, h, min, s));
  if (recurrence === "monthly") {
    const tm = m + i;
    const ty = y + Math.floor(tm / 12);
    const tmo = ((tm % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(ty, tmo + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tmo, Math.min(d, lastDay), h, min, s));
  }
  return null;
}

// Expand a recurring master into occurrence cards that fall inside [from, to).
// `from`/`to` are ISO strings; the master's own start is the first occurrence.
function expandRecurring(master, from, to) {
  const rec = master.recurrence;
  if (!rec || rec === "none" || !from || !to) return [];
  const start = new Date(master.starts_at);
  if (Number.isNaN(start.getTime())) return [];
  const winFrom = new Date(from);
  const winTo = new Date(to);
  const until = master.recurrence_until ? new Date(`${master.recurrence_until}T23:59:59Z`) : null;
  const end = master.ends_at ? new Date(master.ends_at) : null;
  const durationMs = end && !Number.isNaN(end.getTime()) ? end.getTime() - start.getTime() : null;

  // Jump close to the window instead of iterating from occurrence 0.
  let i0 = 0;
  const lead = winFrom.getTime() - start.getTime();
  if (lead > 0) {
    if (rec === "daily") i0 = Math.floor(lead / DAY_MS) - 1;
    else if (rec === "weekly") i0 = Math.floor(lead / (7 * DAY_MS)) - 1;
    else if (rec === "biweekly") i0 = Math.floor(lead / (14 * DAY_MS)) - 1;
    else if (rec === "monthly") {
      i0 = (winFrom.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (winFrom.getUTCMonth() - start.getUTCMonth()) - 1;
    }
    if (i0 < 0) i0 = 0;
  }

  const out = [];
  const base = eventCard(master);
  for (let i = i0, guard = 0; guard < 1000; i++, guard++) {
    const occ = nthOccurrence(start, rec, i);
    if (!occ) break;
    if (occ >= winTo) break;
    if (until && occ > until) break;
    if (occ >= winFrom) {
      const occEnd = durationMs != null ? new Date(occ.getTime() + durationMs) : null;
      out.push({
        ...base,
        id: master.id, // edit/delete act on the series master
        starts_at: occ.toISOString(),
        ends_at: occEnd ? occEnd.toISOString() : null,
        series_start: master.starts_at,
        series_end: master.ends_at || null,
        is_occurrence: true,
      });
    }
  }
  return out;
}

// Read-only feed events derived from other modules. v1b: Training Credits +
// PTO (both keyed by store_number). Walkthroughs + Reno follow. Feed events
// aren't editable here — clicking them deep-links into the source module.
async function fetchFeeds(supa, scope, fromDate, toDate) {
  if (!fromDate || !toDate) return [];
  const numbers = Array.from(scope.storeNumberSet || []);
  if (!scope.all && numbers.length === 0) return [];
  const out = [];

  // Training Credits — pinned to start_date.
  let tq = supa
    .from("training_credit_requests")
    .select("id, employee_name, training_type, start_date, store_number, status")
    .gte("start_date", fromDate).lt("start_date", toDate);
  if (!scope.all) tq = tq.in("store_number", numbers);
  const { data: trainings } = await tq;
  for (const t of trainings || []) {
    if (!t.start_date || t.status === "Withdrawn" || t.status === "Rejected") continue;
    out.push({
      id: `training:${t.id}`, source: "training", editable: false, link: "/employee-actions",
      title: `Training — ${t.employee_name}`, type: "training",
      starts_at: `${t.start_date}T09:00:00`, ends_at: null, all_day: true,
      scope_type: "store", scope_id: null, store_number: t.store_number,
      notes: t.training_type || null, color: null, created_by_name: null,
    });
  }

  // PTO — date range; overlap with the window.
  let pq = supa
    .from("pto_requests")
    .select("id, employee_name, pto_start_date, pto_end_date, store_number, status")
    .lte("pto_start_date", toDate).gte("pto_end_date", fromDate);
  if (!scope.all) pq = pq.in("store_number", numbers);
  const { data: ptos } = await pq;
  for (const p of ptos || []) {
    if (p.status === "Withdrawn" || p.status === "Rejected") continue;
    out.push({
      id: `pto:${p.id}`, source: "pto", editable: false, link: "/employee-actions",
      title: `${p.employee_name} — PTO`, type: "pto",
      starts_at: `${p.pto_start_date}T09:00:00`,
      ends_at: p.pto_end_date ? `${p.pto_end_date}T17:00:00` : null, all_day: true,
      scope_type: "store", scope_id: null, store_number: p.store_number,
      notes: null, color: null, created_by_name: null,
    });
  }

  // Store_id-keyed feeds (walkthroughs + reno) — resolve number/name for display.
  const storeById = new Map((scope.storeRows || []).map((s) => [s.id, s]));
  const storeIds = Array.from(scope.storeIdSet || []);

  // Walkthroughs — assignment due dates.
  let wq = supa
    .from("walkthrough_assignments")
    .select("id, store_id, due_at, template_id")
    .gte("due_at", fromDate).lt("due_at", toDate);
  if (!scope.all) wq = wq.in("store_id", storeIds);
  const { data: walks } = await wq;
  let tplName = new Map();
  if (walks && walks.length) {
    const tids = [...new Set(walks.map((w) => w.template_id).filter(Boolean))];
    if (tids.length) {
      const { data: tpls } = await supa.from("walkthrough_templates").select("id, name").in("id", tids);
      tplName = new Map((tpls || []).map((t) => [t.id, t.name]));
    }
  }
  for (const w of walks || []) {
    if (!w.due_at) continue;
    const st = storeById.get(w.store_id);
    out.push({
      id: `walkthrough:${w.id}`, source: "walkthrough", editable: false, link: "/walkthroughs",
      title: tplName.get(w.template_id) || "Walkthrough", type: "audit",
      starts_at: w.due_at, ends_at: null, all_day: true,
      scope_type: "store", scope_id: null, store_number: st ? String(st.number) : null,
      notes: null, color: null, created_by_name: null,
    });
  }

  // Reno scoping — one row per store visit (scope_date).
  let rq = supa
    .from("reno_scopes")
    .select("id, store_id, scope_date")
    .gte("scope_date", fromDate).lt("scope_date", toDate);
  if (!scope.all) rq = rq.in("store_id", storeIds);
  const { data: renos } = await rq;
  for (const r of renos || []) {
    const st = storeById.get(r.store_id);
    out.push({
      id: `reno:${r.id}`, source: "reno", editable: false, link: "/reno-scoping",
      title: st?.name ? `Reno scoping — ${st.name}` : "Reno scoping", type: "renovation",
      starts_at: `${r.scope_date}T09:00:00`, ends_at: null, all_day: true,
      scope_type: "store", scope_id: null, store_number: st ? String(st.number) : null,
      notes: null, color: null, created_by_name: null,
    });
  }

  return out;
}

async function listEvents(supa, user, params) {
  const scope = await resolveScope(supa, user);
  const from = sanitize(params.from, 40);
  const to = sanitize(params.to, 40);

  // One-off events whose start falls in the window.
  let oneOffQ = supa.from("schedule_events").select("*").eq("recurrence", "none");
  if (from) oneOffQ = oneOffQ.gte("starts_at", from);
  if (to) oneOffQ = oneOffQ.lt("starts_at", to);
  oneOffQ = oneOffQ.order("starts_at", { ascending: true }).limit(2000);

  // Recurring masters that could project into the window: anything that
  // starts before `to` and whose series hasn't ended before `from`. The
  // expander does the precise per-occurrence windowing.
  let masterQ = supa.from("schedule_events").select("*").neq("recurrence", "none");
  if (to) masterQ = masterQ.lt("starts_at", to);
  if (from) masterQ = masterQ.or(`recurrence_until.is.null,recurrence_until.gte.${from.slice(0, 10)}`);
  masterQ = masterQ.limit(2000);

  const [oneOff, masters] = await Promise.all([oneOffQ, masterQ]);
  if (oneOff.error) return { error: oneOff.error.message, status: 500 };
  if (masters.error) return { error: masters.error.message, status: 500 };

  const visible = (oneOff.data || []).filter((e) => nodeInScope(scope, e.scope_type, e.scope_id));
  const occurrences = [];
  for (const m of masters.data || []) {
    if (!nodeInScope(scope, m.scope_type, m.scope_id)) continue;
    occurrences.push(...expandRecurring(m, from, to));
  }

  const feeds = await fetchFeeds(supa, scope, from ? from.slice(0, 10) : null, to ? to.slice(0, 10) : null);
  return {
    events: [...visible.map(eventCard), ...occurrences, ...feeds],
    can_write: WRITE_ROLES.has(String(user.role)),
  };
}

async function listStores(supa, user) {
  const scope = await resolveScope(supa, user);
  // Group stores by district.
  const distMap = new Map();
  for (const s of scope.storeRows) {
    const key = s.district_id || "none";
    if (!distMap.has(key)) {
      const d = scope.districtById.get(s.district_id);
      distMap.set(key, {
        district_id: s.district_id, district_name: d?.name || null,
        district_code: d?.code || null, area_id: d?.area_id || null, stores: [],
      });
    }
    distMap.get(key).stores.push({ id: s.id, number: String(s.number), name: s.name });
  }
  const districts = Array.from(distMap.values());
  // Group districts into areas, then areas into regions, for the nested filter
  // tree (region → area → district → store).
  const areaMap = new Map();
  for (const d of districts) {
    const key = d.area_id || "none";
    if (!areaMap.has(key)) {
      const a = scope.areaById?.get(d.area_id);
      areaMap.set(key, {
        area_id: d.area_id,
        area_name: a?.name || (d.area_id ? null : "Stores"),
        region_id: a?.region_id || null,
        districts: [],
      });
    }
    areaMap.get(key).districts.push(d);
  }
  const regionMap = new Map();
  for (const a of areaMap.values()) {
    const key = a.region_id || "none";
    if (!regionMap.has(key)) {
      const r = scope.regionById?.get(a.region_id);
      regionMap.set(key, {
        region_id: a.region_id,
        region_name: r?.name || r?.code || (a.region_id ? null : "Stores"),
        areas: [],
      });
    }
    regionMap.get(key).areas.push(a);
  }
  return {
    districts, // flat — used by the event picker
    tree: Array.from(regionMap.values()), // region → area → district → store — filter sidebar
    you: scope.primaryScope || { scope_type: null, scope_id: null }, // node to badge "YOU"
    can_org_wide: ORG_WIDE.has(String(user.role)),
    can_write: WRITE_ROLES.has(String(user.role)),
  };
}

function validateEventBody(body) {
  const title = sanitize(body?.title, 200);
  if (!title) return { error: "Title is required.", status: 400 };
  const type = sanitize(body?.type, 40);
  if (!EVENT_TYPES.has(type)) return { error: "Invalid event type.", status: 400 };
  const startsAt = sanitize(body?.starts_at, 40);
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return { error: "A valid start is required.", status: 400 };
  const endsAt = body?.ends_at && !Number.isNaN(Date.parse(body.ends_at)) ? body.ends_at : null;
  const scopeType = sanitize(body?.scope_type, 20);
  if (!SCOPE_TYPES.has(scopeType)) return { error: "Invalid scope.", status: 400 };
  const scopeId = scopeType === "org" ? null : sanitize(body?.scope_id, 64) || null;
  if (scopeType !== "org" && !scopeId) return { error: "Pick where this event belongs.", status: 400 };
  const recurrence = RECURRENCE_TYPES.has(body?.recurrence) ? body.recurrence : "none";
  const recurrenceUntil =
    recurrence !== "none" &&
    typeof body?.recurrence_until === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.recurrence_until)
      ? body.recurrence_until
      : null;
  return {
    fields: {
      title,
      type,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: body?.all_day === true,
      scope_type: scopeType,
      scope_id: scopeId,
      store_number: sanitize(body?.store_number, 20) || null,
      notes: sanitize(body?.notes, 2000) || null,
      color: sanitize(body?.color, 20) || null,
      recurrence,
      recurrence_until: recurrenceUntil,
    },
  };
}

async function assertCanWriteNode(supa, user, scopeType, scopeId) {
  if (!WRITE_ROLES.has(String(user.role))) return { error: "Your role can't create events.", status: 403 };
  if (scopeType === "org" && !ORG_WIDE.has(String(user.role))) {
    return { error: "Only company leadership can create org-wide events.", status: 403 };
  }
  const scope = await resolveScope(supa, user);
  if (!nodeInScope(scope, scopeType, scopeId)) {
    return { error: "That store/area is outside your scope.", status: 403 };
  }
  return null;
}

async function createEvent(supa, user, body) {
  const v = validateEventBody(body);
  if (v.error) return v;
  const permErr = await assertCanWriteNode(supa, user, v.fields.scope_type, v.fields.scope_id);
  if (permErr) return permErr;

  const { data, error } = await supa
    .from("schedule_events")
    .insert({ ...v.fields, created_by: user.id, created_by_name: displayName(user) })
    .select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, event: eventCard(data) };
}

async function updateEvent(supa, user, body) {
  const id = sanitize(body?.id, 64);
  if (!id) return { error: "Event id is required.", status: 400 };
  const { data: existing } = await supa.from("schedule_events").select("*").eq("id", id).maybeSingle();
  if (!existing) return { error: "Event not found.", status: 404 };
  // Must have scope over BOTH the current node and the new one.
  const curErr = await assertCanWriteNode(supa, user, existing.scope_type, existing.scope_id);
  if (curErr) return curErr;
  const v = validateEventBody(body);
  if (v.error) return v;
  const newErr = await assertCanWriteNode(supa, user, v.fields.scope_type, v.fields.scope_id);
  if (newErr) return newErr;

  const { data, error } = await supa
    .from("schedule_events").update({ ...v.fields, updated_at: new Date().toISOString() })
    .eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, event: eventCard(data) };
}

async function deleteEvent(supa, user, body) {
  const id = sanitize(body?.id, 64);
  if (!id) return { error: "Event id is required.", status: 400 };
  const { data: existing } = await supa.from("schedule_events").select("*").eq("id", id).maybeSingle();
  if (!existing) return { error: "Event not found.", status: 404 };
  const permErr = await assertCanWriteNode(supa, user, existing.scope_type, existing.scope_id);
  if (permErr) return permErr;
  const { error } = await supa.from("schedule_events").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let user;
  try {
    user = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";
  let body = {};
  if (event.httpMethod === "POST") {
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  }
  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listEvents(supa, user, params));
      if (action === "stores") return unwrap(await listStores(supa, user));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "create") return unwrap(await createEvent(supa, user, body));
    if (action === "update") return unwrap(await updateEvent(supa, user, body));
    if (action === "delete") return unwrap(await deleteEvent(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
