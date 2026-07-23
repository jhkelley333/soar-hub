// Store Visit — mobile app for DO+ (District Ops and above). The hero is the
// computed Top-3 gaps per store; everything else hangs off the Visit + ActionItem
// models. Service-role gatekeeper: this function enforces scope AND the
// shared-vs-private authorization boundary (private notes never reach the store).
//
// Public? No — every action requires a signed-in DO+ session.
//
// Actions (GET):  stores | today | gaps | template | visit-get | actions | reviews
// Actions (POST): visit-start | walk-save | visit-submit | review-create | funds-reviewed

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// DO and above may run visits. Private notes are readable only by SDO and above
// (or the visit's own author) — the store login never has these roles.
const VISIT_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);
const PRIVATE_READ_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);
const ORG_WIDE = new Set(["vp", "coo", "admin"]);
const REVIEW_PUSH_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]); // who can push a review down
const PHOTO_BUCKET = "store-visit-photos";
const PHOTO_TTL = 60 * 60 * 24 * 7; // signed download URLs live a week

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("store-visit env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
const roleOf = (u) => String(u?.role || "").toLowerCase();
const displayName = (u) => u?.preferred_name || u?.full_name || u?.email || "someone";
const numOr = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));

async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// ── scope ────────────────────────────────────────────────────────────
// The stores a DO+ caller may visit. Org-wide roles (VP/COO/admin) are org-wide
// by ROLE and often have no user_scopes row, so user_visible_stores can be
// empty for them — return all active stores instead.
async function visibleStores(supa, user) {
  if (ORG_WIDE.has(roleOf(user))) {
    const { data } = await supa
      .from("stores")
      .select("id, number, name, city, state, address, district_id, is_active")
      .eq("is_active", true).order("number");
    return data ?? [];
  }
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean);
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supa
      .from("stores")
      .select("id, number, name, city, state, address, district_id, is_active")
      .in("id", ids.slice(i, i + 500)).eq("is_active", true).order("number");
    out.push(...(data ?? []));
  }
  return out;
}

async function resolveStore(supa, user, params) {
  const stores = await visibleStores(supa, user);
  const byId = params.store_id ? stores.find((s) => s.id === params.store_id) : null;
  const byNum = params.store ? stores.find((s) => String(s.number) === String(params.store)) : null;
  return { store: byId || byNum || null, stores };
}

// ── gap metric adapters ──────────────────────────────────────────────
// Resolve one metric's current { valueRaw, targetRaw } for a store from its
// source. Unwired sources return null and are simply skipped.
async function metricValue(supa, metric, store) {
  if (metric.source === "labor") {
    const { data } = await supa
      .from("labor_v2_daily")
      .select("labor_pct, target_labor_pct, business_date")
      .eq("store_number", String(store.number))
      .order("business_date", { ascending: false })
      .limit(1).maybeSingle();
    if (!data) return { valueRaw: null, targetRaw: null };
    return { valueRaw: numOr(data.labor_pct), targetRaw: numOr(data.target_labor_pct) ?? numOr(metric.target_raw) };
  }
  if (metric.source === "walk") {
    const { data } = await supa
      .from("store_visits")
      .select("walk_score")
      .eq("store_id", store.id).eq("status", "submitted")
      .not("walk_score", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(1).maybeSingle();
    return { valueRaw: data ? numOr(data.walk_score) : null, targetRaw: numOr(metric.target_raw) };
  }
  // manual / unwired — no live feed yet.
  return { valueRaw: null, targetRaw: numOr(metric.target_raw) };
}

function severityOf(metric, valueRaw, targetRaw) {
  if (valueRaw == null || targetRaw == null || targetRaw === 0) return null;
  return metric.direction === "lower"
    ? (valueRaw - targetRaw) / targetRaw      // lower is better (time, labor)
    : (targetRaw - valueRaw) / targetRaw;     // higher is better
}

function fmtVal(unit, raw) {
  if (raw == null) return "—";
  if (unit === "pct") return `${(raw * 100).toFixed(1)}%`;
  if (unit === "time") {
    const s = Math.round(raw);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  return String(Math.round(raw * 10) / 10);
}
function fmtDelta(unit, diff) {
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const mag = Math.abs(diff);
  if (unit === "pct") return `${sign}${(mag * 100).toFixed(0)}`;
  if (unit === "time") { const s = Math.round(mag); return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  return `${sign}${Math.round(mag * 10) / 10}`;
}

// Top-N gaps: rank active metrics by severity>0, worst first, with trend vs the
// last completed visit's snapshot of the same metric.
async function computeGaps(supa, store, limit = 3) {
  const { data: metrics } = await supa
    .from("store_visit_metrics").select("*").eq("is_active", true).order("sort");
  const { data: snaps } = await supa
    .from("visit_metric_snapshots")
    .select("metric_key, value_raw, severity, captured_at")
    .eq("store_id", store.id)
    .order("captured_at", { ascending: false });
  const lastByKey = new Map();
  for (const s of snaps ?? []) if (!lastByKey.has(s.metric_key)) lastByKey.set(s.metric_key, s);

  const rows = [];
  for (const m of metrics ?? []) {
    const { valueRaw, targetRaw } = await metricValue(supa, m, store);
    const severity = severityOf(m, valueRaw, targetRaw);
    if (severity == null || severity <= 0) continue;
    const prev = lastByKey.get(m.key);
    let dir = "flat", delta = null;
    if (prev && prev.value_raw != null && valueRaw != null) {
      const diff = valueRaw - Number(prev.value_raw);
      const worse = m.direction === "lower" ? diff > 0 : diff < 0;
      const better = m.direction === "lower" ? diff < 0 : diff > 0;
      dir = better ? "up" : worse ? "down" : "flat";
      if (diff !== 0) delta = fmtDelta(m.unit, m.direction === "lower" ? diff : -diff);
    }
    rows.push({
      metric: m.key, label: m.label, unit: m.unit,
      value: fmtVal(m.unit, valueRaw), valueRaw,
      target: fmtVal(m.unit, targetRaw), targetRaw,
      severity: Math.round(severity * 1000) / 1000, dir, delta,
    });
  }
  rows.sort((a, b) => b.severity - a.severity);
  return rows.slice(0, limit);
}

// ── reads ────────────────────────────────────────────────────────────
async function listStores(supa, user) {
  const stores = await visibleStores(supa, user);
  return { stores: stores.map((s) => ({ id: s.id, number: String(s.number), name: s.name, city: s.city, state: s.state })) };
}

async function todayScreen(supa, user, params) {
  const { store } = await resolveStore(supa, user, params);
  if (!store) return { error: "Pick a store you manage.", status: 404 };
  const [gaps, { data: reviews }, { data: openActions }, { data: lastVisit }] = await Promise.all([
    computeGaps(supa, store, 3),
    supa.from("review_requests").select("id, text, by_role, item_id, created_at").eq("store_id", store.id).is("resolved_at", null).order("created_at"),
    supa.from("action_items").select("id").eq("store_id", store.id).neq("status", "resolved"),
    supa.from("store_visits").select("id, funds_reviewed, submitted_at").eq("store_id", store.id).eq("status", "submitted").order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    store: { id: store.id, number: String(store.number), name: store.name, city: store.city, state: store.state, address: store.address },
    gaps,
    reviews: reviews ?? [],
    open_actions: (openActions ?? []).length,
    funds_reviewed: false, // per-visit; the current visit starts unreviewed
    last_visit_at: lastVisit?.submitted_at ?? null,
  };
}

async function getTemplate(supa) {
  const { data: tpl } = await supa
    .from("checklist_templates").select("id, name").eq("is_active", true).order("created_at").limit(1).maybeSingle();
  if (!tpl) return { template: null, items: [] };
  const { data: items } = await supa
    .from("checklist_items").select("id, category, label, sort, required_by_role").eq("template_id", tpl.id).order("sort");
  return { template: tpl, items: items ?? [] };
}

// Photo records persist as { path, at, lat, lng }. On read we attach a fresh
// signed download URL so the client can render the thumbnail.
async function signPhotos(supa, arr) {
  const out = [];
  for (const p of arr || []) {
    const path = typeof p === "string" ? p : p?.path;
    if (!path) continue;
    const { data } = await supa.storage.from(PHOTO_BUCKET).createSignedUrl(path, PHOTO_TTL);
    out.push({ ...(typeof p === "object" && p ? p : {}), path, url: data?.signedUrl ?? null });
  }
  return out;
}

// A signed PUT URL for one visit photo. Caller must be the visitor (or org-wide).
async function photoUploadUrl(supa, user, body) {
  const visitId = body?.visit_id;
  if (!visitId) return { error: "visit_id required", status: 400 };
  const { data: visit } = await supa.from("store_visits").select("id, visitor_id, status").eq("id", visitId).maybeSingle();
  if (!visit) return { error: "Visit not found.", status: 404 };
  if (visit.visitor_id !== user.id && !ORG_WIDE.has(roleOf(user))) return { error: "Not your visit.", status: 403 };
  const kind = body?.kind === "summary" ? "summary" : "walk";
  const ext = /^(jpe?g|png|webp|heic)$/i.test(String(body?.ext || "")) ? String(body.ext).toLowerCase() : "jpg";
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${visitId}/${kind}/${Date.now()}-${rand}.${ext}`;
  const { data, error } = await supa.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error) return { error: error.message, status: 500 };
  return { upload_url: data.signedUrl, token: data.token, path };
}

function stripPrivate(visit, user) {
  const canRead = PRIVATE_READ_ROLES.has(roleOf(user)) || visit.visitor_id === user.id;
  if (canRead) return visit;
  const { private_note, ...rest } = visit; // eslint-disable-line no-unused-vars
  return { ...rest, private_note: null };
}

async function getVisit(supa, user, params) {
  const id = params.visit_id;
  if (!id) return { error: "visit_id required", status: 400 };
  const { data: visit } = await supa.from("store_visits").select("*").eq("id", id).maybeSingle();
  if (!visit) return { error: "Visit not found.", status: 404 };
  const { data: results } = await supa.from("walk_results").select("*").eq("visit_id", id);
  const signedResults = [];
  for (const r of results ?? []) signedResults.push({ ...r, photos: await signPhotos(supa, r.photos) });
  const safe = stripPrivate(visit, user);
  return { visit: { ...safe, summary_photos: await signPhotos(supa, visit.summary_photos) }, results: signedResults };
}

async function listActions(supa, user, params) {
  const { store } = await resolveStore(supa, user, params);
  if (!store) return { error: "Pick a store you manage.", status: 404 };
  const { data } = await supa.from("action_items")
    .select("*").eq("store_id", store.id).neq("status", "resolved")
    .order("priority").order("created_at", { ascending: false });
  return { actions: data ?? [] };
}

async function storeHistory(supa, user, params) {
  const { store } = await resolveStore(supa, user, params);
  if (!store) return { error: "Pick a store you manage.", status: 404 };
  const { data: visits } = await supa.from("store_visits")
    .select("id, visitor_id, visitor_role, submitted_at, walk_score, summary, private_note")
    .eq("store_id", store.id).eq("status", "submitted")
    .order("submitted_at", { ascending: true });
  const list = visits ?? [];
  const ids = [...new Set(list.map((v) => v.visitor_id).filter(Boolean))];
  const nameById = new Map();
  if (ids.length) {
    const { data: profs } = await supa.from("profiles").select("id, full_name, preferred_name").in("id", ids);
    for (const p of profs ?? []) nameById.set(p.id, p.preferred_name || p.full_name || null);
  }
  const { data: acts } = await supa.from("action_items").select("origin_visit_id").eq("store_id", store.id);
  const actCount = new Map();
  for (const a of acts ?? []) if (a.origin_visit_id) actCount.set(a.origin_visit_id, (actCount.get(a.origin_visit_id) || 0) + 1);

  const canReadPrivate = PRIVATE_READ_ROLES.has(roleOf(user));
  let prevScore = null;
  const out = list.map((v) => {
    const score = v.walk_score == null ? null : Number(v.walk_score);
    const trend = score != null && prevScore != null ? (score > prevScore ? "up" : score < prevScore ? "down" : "flat") : null;
    const delta = score != null && prevScore != null ? Math.round((score - prevScore) * 100) : null;
    if (score != null) prevScore = score;
    return {
      id: v.id,
      visitor: nameById.get(v.visitor_id) ?? null,
      role: v.visitor_role,
      submitted_at: v.submitted_at,
      walk_score: score,
      trend, delta,
      summary: v.summary,
      has_private_note: !!v.private_note,
      private_note: canReadPrivate || v.visitor_id === user.id ? v.private_note : null,
      actions: actCount.get(v.id) || 0,
    };
  });
  out.reverse(); // newest first
  return { visits: out };
}

async function listReviews(supa, user, params) {
  const { store } = await resolveStore(supa, user, params);
  if (!store) return { error: "Pick a store you manage.", status: 404 };
  const { data } = await supa.from("review_requests")
    .select("*").eq("store_id", store.id).is("resolved_at", null).order("created_at");
  return { reviews: data ?? [] };
}

// ── writes ───────────────────────────────────────────────────────────
async function startVisit(supa, user, body) {
  const { store } = await resolveStore(supa, user, body);
  if (!store) return { error: "Pick a store you manage.", status: 403 };
  const { template, items } = await getTemplate(supa);
  const { data, error } = await supa.from("store_visits").insert({
    store_id: store.id, visitor_id: user.id, visitor_role: roleOf(user), template_id: template?.id ?? null,
  }).select("id").single();
  if (error) return { error: error.message, status: 500 };
  return { visit_id: data.id, template, items };
}

async function saveWalk(supa, user, body) {
  const visitId = body?.visit_id;
  if (!visitId) return { error: "visit_id required", status: 400 };
  const { data: visit } = await supa.from("store_visits").select("id, visitor_id, status").eq("id", visitId).maybeSingle();
  if (!visit) return { error: "Visit not found.", status: 404 };
  if (visit.status === "submitted") return { error: "This visit is already submitted.", status: 409 };
  const status = ["pass", "gap", "na"].includes(body?.status) ? body.status : "pass";
  const row = {
    visit_id: visitId, item_id: body?.item_id ?? null, category: body?.category ?? null,
    label: body?.label ?? null, status, note: (body?.note ?? "").trim() || null,
    photos: Array.isArray(body?.photos) ? body.photos : [],
  };
  // Upsert on (visit_id, item_id) so re-tapping a control replaces the result.
  const { error } = await supa.from("walk_results").upsert(row, { onConflict: "visit_id,item_id" });
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function submitVisit(supa, user, body) {
  const visitId = body?.visit_id;
  if (!visitId) return { error: "visit_id required", status: 400 };
  const { data: visit } = await supa.from("store_visits").select("*").eq("id", visitId).maybeSingle();
  if (!visit) return { error: "Visit not found.", status: 404 };
  if (visit.visitor_id !== user.id && !ORG_WIDE.has(roleOf(user))) {
    return { error: "Only the visitor can submit this visit.", status: 403 };
  }

  // Walk score = % of scored (pass|gap) items that passed. N/A excluded.
  const { data: results } = await supa.from("walk_results").select("status").eq("visit_id", visitId);
  const scored = (results ?? []).filter((r) => r.status === "pass" || r.status === "gap");
  const walkScore = scored.length ? scored.filter((r) => r.status === "pass").length / scored.length : null;

  const patch = {
    status: "submitted",
    submitted_at: new Date().toISOString(),
    walk_score: walkScore,
    summary: (body?.summary ?? "").trim() || null,
    summary_photos: Array.isArray(body?.summary_photos) ? body.summary_photos : [],
    private_note: (body?.private_note ?? "").trim() || null,
    funds_reviewed: !!body?.funds_reviewed,
  };
  const { error } = await supa.from("store_visits").update(patch).eq("id", visitId);
  if (error) return { error: error.message, status: 500 };

  // Snapshot each metric now, so the NEXT visit can trend against this one.
  const { store } = await resolveStore(supa, user, { store_id: visit.store_id });
  const storeRow = store || { id: visit.store_id, number: null };
  const { data: metrics } = await supa.from("store_visit_metrics").select("*").eq("is_active", true);
  const snaps = [];
  for (const m of metrics ?? []) {
    if (storeRow.number == null && m.source === "labor") continue;
    const { valueRaw, targetRaw } = await metricValue(supa, m, storeRow);
    if (valueRaw == null) continue;
    snaps.push({ visit_id: visitId, store_id: visit.store_id, metric_key: m.key, value_raw: valueRaw, target_raw: targetRaw, severity: severityOf(m, valueRaw, targetRaw) });
  }
  if (snaps.length) await supa.from("visit_metric_snapshots").insert(snaps);

  // Optional: create carry-forward action items submitted with the visit.
  const actions = Array.isArray(body?.actions) ? body.actions : [];
  if (actions.length) {
    const rows = actions
      .filter((a) => a && String(a.text || "").trim())
      .map((a) => ({
        store_id: visit.store_id, origin_visit_id: visitId, text: String(a.text).trim(),
        owner: a.owner ?? null, priority: ["high", "med", "low"].includes(a.priority) ? a.priority : "med",
        due: a.due ?? null,
      }));
    if (rows.length) await supa.from("action_items").insert(rows);
  }

  // Close any review requests that were open until this visit.
  await supa.from("review_requests").update({ resolved_at: new Date().toISOString() })
    .eq("store_id", visit.store_id).is("resolved_at", null).eq("open_until_visit_id", visitId);

  return { ok: true, visit_id: visitId, walk_score: walkScore };
}

async function createAction(supa, user, body) {
  const { store } = await resolveStore(supa, user, body);
  if (!store) return { error: "Pick a store you manage.", status: 403 };
  const text = String(body?.text ?? "").trim();
  if (!text) return { error: "Enter the action.", status: 400 };
  const priority = ["high", "med", "low"].includes(body?.priority) ? body.priority : "med";
  const { data, error } = await supa.from("action_items").insert({
    store_id: store.id,
    origin_visit_id: body?.visit_id ?? null,
    text,
    owner: (body?.owner ?? "").trim() || null,
    priority,
    due: body?.due || null,
    log: [{ who: displayName(user), at: new Date().toISOString(), text: "Created" }],
  }).select("id").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, id: data.id };
}

async function updateAction(supa, user, body) {
  const id = body?.id;
  if (!id) return { error: "id required", status: 400 };
  const { data: existing } = await supa.from("action_items").select("id, store_id, log, status").eq("id", id).maybeSingle();
  if (!existing) return { error: "Action not found.", status: 404 };
  const { store } = await resolveStore(supa, user, { store_id: existing.store_id });
  if (!store) return { error: "That store is outside your scope.", status: 403 };
  const patch = { updated_at: new Date().toISOString() };
  const STATUSES = new Set(["open", "improved", "worse", "resolved"]);
  if (body?.status && STATUSES.has(body.status)) patch.status = body.status;
  if (typeof body?.text === "string" && body.text.trim()) patch.text = body.text.trim();
  if (["high", "med", "low"].includes(body?.priority)) patch.priority = body.priority;
  const logText = body?.status ? `Marked ${body.status}` : "Updated";
  patch.log = [...(existing.log ?? []), { who: displayName(user), at: new Date().toISOString(), text: (body?.note ?? "").trim() || logText }];
  const { error } = await supa.from("action_items").update(patch).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function createReview(supa, user, body) {
  if (!REVIEW_PUSH_ROLES.has(roleOf(user))) return { error: "Only SDO and above can push a review request.", status: 403 };
  const { store } = await resolveStore(supa, user, body);
  if (!store) return { error: "Pick a store you manage.", status: 403 };
  const text = String(body?.text ?? "").trim();
  if (!text) return { error: "Enter what to review.", status: 400 };
  const { data, error } = await supa.from("review_requests").insert({
    store_id: store.id, by_user_id: user.id, by_role: roleOf(user), text, item_id: body?.item_id ?? null,
  }).select("id").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, id: data.id };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }

  let user;
  try { user = await getSessionUser(supa, event); } catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  if (!VISIT_ROLES.has(roleOf(user))) return respond(403, { error: "Store Visit is for District Ops and above." });

  const params = event.queryStringParameters || {};
  const action = params.action || "today";
  const unwrap = (out) => (out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out }));

  try {
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      const a = body.action || action;
      if (a === "visit-start") return unwrap(await startVisit(supa, user, body));
      if (a === "walk-save") return unwrap(await saveWalk(supa, user, body));
      if (a === "visit-submit") return unwrap(await submitVisit(supa, user, body));
      if (a === "review-create") return unwrap(await createReview(supa, user, body));
      if (a === "action-create") return unwrap(await createAction(supa, user, body));
      if (a === "action-update") return unwrap(await updateAction(supa, user, body));
      if (a === "photo-upload-url") return unwrap(await photoUploadUrl(supa, user, body));
      return respond(400, { error: `Unknown action: ${a}` });
    }
    if (action === "stores") return unwrap(await listStores(supa, user));
    if (action === "today") return unwrap(await todayScreen(supa, user, params));
    if (action === "gaps") {
      const { store } = await resolveStore(supa, user, params);
      if (!store) return respond(404, { error: "Pick a store you manage." });
      return unwrap({ gaps: await computeGaps(supa, store, Number(params.limit) || 3) });
    }
    if (action === "template") return unwrap(await getTemplate(supa));
    if (action === "visit-get") return unwrap(await getVisit(supa, user, params));
    if (action === "actions") return unwrap(await listActions(supa, user, params));
    if (action === "reviews") return unwrap(await listReviews(supa, user, params));
    if (action === "history") return unwrap(await storeHistory(supa, user, params));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: `store-visit error: ${e?.message || String(e)}` });
  }
};
