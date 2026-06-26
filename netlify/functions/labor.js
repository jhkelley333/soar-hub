// netlify/functions/labor.js
//
// Labor module — read/write API for the GM + DO views.
//
// Auth + scope mirror employee-actions.js / paf.js: validate the Supabase
// JWT with the service-role key, look up the profile, gate on role, and
// resolve the caller's visible stores via user_visible_stores(). Labor
// exposes store financials, so every row is scope-checked in code (the
// tables are RLS-locked with no policies).
//
// Numbers come from labor_daily_snapshots (the nightly/poll capture of the
// labor Google Sheet). Derived values (variance vs. the base PTD goal,
// chart-$ allowed, miss/on-chart status) are computed here so the schema
// stays a faithful mirror of the sheet. The GM's explanation lives in
// labor_reviews (free-text note, one per store/business_date).
//
// "Miss" rule: a day needs an explanation when its labor % runs OVER the
// base goal by more than MISS_TOLERANCE_PTS (default 0.5). Days within
// tolerance read as "on chart". A note clears the miss regardless.
//
// Week strip: Monday–Sunday (the SOAR labor week). The 7-day strip is the
// Mon–Sun week containing the anchor business_date.
//
// Actions:
//   GET  ?action=gm&store=NUM[&date=YYYY-MM-DD]
//          -> { store, date, day, week[], goal, ... } the GM day view
//   GET  ?action=district[&district=ID][&date=YYYY-MM-DD]
//          -> { rollup, stores[] } the DO district view
//   GET  ?action=my-stores   -> { stores[] } the caller can view labor for
//   GET  ?action=districts   -> { districts[] } the caller can pick from
//          (SDO sees their area's districts, RVP their region's, etc.)
//   POST ?action=review  { store_number, business_date, note }
//          -> upsert the GM's explanation for that store/day

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const READ_ROLES = new Set(["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]);
const REVIEW_ROLES = new Set(["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "admin"]);
const ORG_WIDE = new Set(["payroll", "admin", "vp", "coo"]);
// Who can see the sync-status panel (the labor pipeline health view).
const SYNC_ROLES = new Set(["admin", "vp", "coo"]);

// A day is a "miss" (note due) when labor runs over the goal by more than
// this many points. Tunable without a deploy via env.
const MISS_TOLERANCE_PTS = floatEnv(process.env.LABOR_MISS_TOLERANCE_PTS, 0.5);

function floatEnv(v, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("labor env vars not configured");
  }
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
    .select("id, email, full_name, preferred_name, role, primary_store_id, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function unwrap(result) {
  if (result && typeof result === "object" && "status" in result && "error" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

// ── Scope helpers (mirror employee-actions.js) ───────────────────────
async function resolveVisibleStoreRows(supa, userId) {
  const { data: visibleIds } = await supa.rpc("user_visible_stores", { uid: userId });
  const ids = (visibleIds ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa
    .from("stores")
    .select("id, number, name, district_id, is_active")
    .in("id", ids)
    .eq("is_active", true)
    .order("number");
  return data ?? [];
}

// ── Date / week helpers (Monday–Sunday weeks) ────────────────────────
function pad2(n) { return String(n).padStart(2, "0"); }
function isoOf(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function shiftDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
// The Mon–Sun week (7 ISO date strings) containing `anchor`.
function weekDates(anchor) {
  const dow = anchor.getUTCDay();            // 0=Sun … 6=Sat
  const back = (dow + 6) % 7;                // days since Monday
  const monday = shiftDays(anchor, -back);
  return Array.from({ length: 7 }, (_, i) => isoOf(shiftDays(monday, i)));
}

// ── Derivation ───────────────────────────────────────────────────────
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Status for one band's labor% vs. goal. Negative variance = under goal
// (good). Over by > tolerance = "over" (a daily miss → note due).
function chartStatus(laborPct, goalPct) {
  if (laborPct == null || goalPct == null) return "unknown";
  const varPts = laborPct - goalPct;
  if (varPts > MISS_TOLERANCE_PTS) return "over";
  return "on";
}

// Shape one snapshot row + its review into the per-day object the UI binds.
function shapeDay(snap, review, goalPct) {
  if (!snap) return null;
  const labor = snap.daily_labor_pct;
  const status = chartStatus(labor, goalPct);
  const sales = snap.daily_sales;
  const chartAllowed =
    sales != null && goalPct != null ? round2(sales * (goalPct / 100)) : null;
  const explained = !!review;
  return {
    business_date: snap.business_date,
    labor_pct: labor,
    sales,
    variance_pts: labor != null && goalPct != null ? round1(labor - goalPct) : null,
    dollars_over_chart: snap.daily_dollars_over_chart,
    hours_over_chart: snap.daily_hours_over_chart,
    chart_dollars_allowed: chartAllowed,
    status,                                   // "on" | "over" | "unknown"
    note_due: status === "over" && !explained,
    explained,
    review: review
      ? { note: review.note, by: review.reviewed_by_email, at: review.updated_at }
      : null,
  };
}

function shapeBand(snap, prefix, goalPct) {
  if (!snap) return null;
  const labor = snap[`${prefix}_labor_pct`];
  const sales = snap[`${prefix}_sales`];
  return {
    labor_pct: labor,
    sales,
    variance_pts: labor != null && goalPct != null ? round1(labor - goalPct) : null,
    dollars_over_chart: snap[`${prefix}_dollars_over_chart`],
    hours_over_chart: snap[`${prefix}_hours_over_chart`],
    chart_dollars_allowed:
      sales != null && goalPct != null ? round2(sales * (goalPct / 100)) : null,
    status: chartStatus(labor, goalPct),
  };
}

// ── my-stores ────────────────────────────────────────────────────────
async function listMyStores(supa, user) {
  if (!READ_ROLES.has(user.role)) return { stores: [] };
  if (user.role === "admin") {
    const { data } = await supa
      .from("stores")
      .select("id, number, name, district_id, is_active")
      .eq("is_active", true)
      .order("number");
    return { stores: data ?? [] };
  }
  return { stores: await resolveVisibleStoreRows(supa, user.id) };
}

// ── districts ────────────────────────────────────────────────────────
// The districts the caller can pick from in the district view. Derived
// from their visible stores, so an SDO gets every district in their area
// and an RVP every district in their region. Admin/org-wide get all.
// Returns [{ id, name, code, store_count }] sorted by name.
async function listDistricts(supa, user) {
  if (!READ_ROLES.has(user.role)) return { districts: [] };

  let storeRows;
  if (user.role === "admin" || ORG_WIDE.has(user.role)) {
    const { data } = await supa
      .from("stores")
      .select("district_id")
      .eq("is_active", true);
    storeRows = data ?? [];
  } else {
    storeRows = await resolveVisibleStoreRows(supa, user.id);
  }

  // Count stores per district to surface "18 stores" in the picker.
  const counts = new Map();
  for (const s of storeRows) {
    if (!s.district_id) continue;
    counts.set(s.district_id, (counts.get(s.district_id) ?? 0) + 1);
  }
  const ids = Array.from(counts.keys());
  if (!ids.length) return { districts: [] };

  const { data: districts } = await supa
    .from("districts")
    .select("id, name, code")
    .in("id", ids);

  const out = (districts ?? [])
    .map((d) => ({ id: d.id, name: d.name, code: d.code, store_count: counts.get(d.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { districts: out };
}

// ── Sync status (pipeline health) ────────────────────────────────────
// Recent labor_sync_state rows + a snapshot count, so admins can confirm
// the nightly/poll capture is landing each day. Read-only; the actual
// "sync now" trigger is the labor-snapshot function (?force=1).
async function syncStatus(supa, user) {
  if (!SYNC_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const { data: rows } = await supa
    .from("labor_sync_state")
    .select("*")
    .order("business_date", { ascending: false })
    .limit(30);
  const { count } = await supa
    .from("labor_daily_snapshots")
    .select("id", { count: "exact", head: true });
  return {
    days: rows ?? [],
    latest: rows?.[0] ?? null,
    total_snapshot_rows: count ?? 0,
  };
}

// Most recent business_date we have any snapshot for (the default "yesterday").
async function latestBusinessDate(supa) {
  const { data } = await supa
    .from("labor_daily_snapshots")
    .select("business_date")
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.business_date ?? null;
}

// ── GM view ──────────────────────────────────────────────────────────
async function gmView(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  if (!storeNumber) return { error: "store is required", status: 400 };

  // Scope check (admins/org-wide bypass).
  let storeRow = null;
  if (user.role === "admin" || ORG_WIDE.has(user.role)) {
    const { data } = await supa
      .from("stores").select("id, number, name, district_id")
      .eq("number", storeNumber).maybeSingle();
    storeRow = data;
  } else {
    const visible = await resolveVisibleStoreRows(supa, user.id);
    storeRow = visible.find((s) => String(s.number) === storeNumber) || null;
    if (!storeRow) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };
  }
  if (!storeRow) return { error: `Store ${storeNumber} not found.`, status: 404 };

  const anchorIso = params.date || (await latestBusinessDate(supa));
  if (!anchorIso) return { store: storeRow, date: null, day: null, week: [], goal: null };
  const anchor = parseIso(anchorIso);
  if (!anchor) return { error: "bad date", status: 400 };

  const week = weekDates(anchor);
  const rangeStart = week[0];
  const rangeEnd = week[6];

  const [{ data: snaps }, { data: reviews }] = await Promise.all([
    supa.from("labor_daily_snapshots").select("*")
      .eq("store_number", storeNumber).gte("business_date", rangeStart).lte("business_date", rangeEnd),
    supa.from("labor_reviews").select("*")
      .eq("store_number", storeNumber).gte("business_date", rangeStart).lte("business_date", rangeEnd),
  ]);
  const snapByDate = new Map((snaps ?? []).map((s) => [s.business_date, s]));
  const reviewByDate = new Map((reviews ?? []).map((r) => [r.business_date, r]));

  const anchorSnap = snapByDate.get(anchorIso) || null;
  const goalPct = anchorSnap?.base_ptd_labor_goal ?? null;

  const weekStrip = week.map((iso) => {
    const s = snapByDate.get(iso);
    return {
      business_date: iso,
      labor_pct: s?.daily_labor_pct ?? null,
      status: s ? chartStatus(s.daily_labor_pct, s.base_ptd_labor_goal) : "missing",
      note_due:
        s && chartStatus(s.daily_labor_pct, s.base_ptd_labor_goal) === "over" && !reviewByDate.get(iso),
    };
  });

  return {
    store: { number: storeRow.number, name: storeRow.name, district_id: storeRow.district_id },
    date: anchorIso,
    goal: goalPct,
    goal_source: anchorSnap?.rvp_name ? `set by ${anchorSnap.rvp_name}` : null,
    gm_name: anchorSnap?.gm_name ?? null,
    day: shapeDay(anchorSnap, reviewByDate.get(anchorIso), goalPct),
    wtd: shapeBand(anchorSnap, "wtd", goalPct),
    ptd: shapeBand(anchorSnap, "ptd", goalPct),
    week: weekStrip,
    notes_due: weekStrip.filter((d) => d.note_due).length,
  };
}

// ── DO / district view ───────────────────────────────────────────────
async function districtView(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };

  const anchorIso = params.date || (await latestBusinessDate(supa));
  if (!anchorIso) return { rollup: null, stores: [] };

  // In-scope stores.
  let stores;
  if (user.role === "admin" || ORG_WIDE.has(user.role)) {
    let q = supa.from("stores").select("id, number, name, district_id").eq("is_active", true);
    if (params.district) q = q.eq("district_id", params.district);
    const { data } = await q.order("number");
    stores = data ?? [];
  } else {
    stores = await resolveVisibleStoreRows(supa, user.id);
    if (params.district) stores = stores.filter((s) => s.district_id === params.district);
  }
  if (!stores.length) return { rollup: null, stores: [] };

  const numbers = stores.map((s) => String(s.number));
  const [{ data: snaps }, { data: reviews }] = await Promise.all([
    supa.from("labor_daily_snapshots").select("*").eq("business_date", anchorIso).in("store_number", numbers),
    supa.from("labor_reviews").select("store_number, note, reviewed_by_email, updated_at")
      .eq("business_date", anchorIso).in("store_number", numbers),
  ]);
  const reviewBy = new Map((reviews ?? []).map((r) => [String(r.store_number), r]));
  const storeMeta = new Map(stores.map((s) => [String(s.number), s]));

  const rows = (snaps ?? []).map((s) => {
    const goal = s.base_ptd_labor_goal;
    const status = chartStatus(s.daily_labor_pct, goal);
    const review = reviewBy.get(String(s.store_number));
    return {
      store_number: s.store_number,
      store_name: storeMeta.get(String(s.store_number))?.name ?? s.location_name ?? null,
      gm_name: s.gm_name,
      do_name: s.do_name,
      labor_pct: s.daily_labor_pct,
      variance_pts: s.daily_labor_pct != null && goal != null ? round1(s.daily_labor_pct - goal) : null,
      dollars_over_chart: s.daily_dollars_over_chart,
      hours_over_chart: s.daily_hours_over_chart,
      // Cumulative bands through the anchor date (WTD = Mon-to-date; PTD =
      // SONIC's 4-week period-to-date, the operational "month-to-date").
      wtd_labor_pct: s.wtd_labor_pct,
      ptd_labor_pct: s.ptd_labor_pct,
      wtd_dollars_over_chart: s.wtd_dollars_over_chart,
      ptd_dollars_over_chart: s.ptd_dollars_over_chart,
      status,                                          // on | over | unknown
      explained: !!review,
      note_due: status === "over" && !review,
      note: review?.note ?? null,
    };
  });
  // Worst-first (highest variance over goal at the top).
  rows.sort((a, b) => (b.variance_pts ?? -999) - (a.variance_pts ?? -999));

  const over = rows.filter((r) => r.status === "over");
  const sum = (k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const avg = (k) => {
    const vals = rows.map((r) => r[k]).filter((v) => v != null);
    return vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  // Distinct DO names across the shown stores — one when scoped to a single
  // district, several when an RVP views "all my districts".
  const dos = Array.from(new Set(rows.map((r) => r.do_name).filter(Boolean)));

  return {
    date: anchorIso,
    rollup: {
      store_count: rows.length,
      district_labor_pct: avg("labor_pct"),
      wtd_labor_pct: avg("wtd_labor_pct"),
      ptd_labor_pct: avg("ptd_labor_pct"),
      stores_over_chart: over.length,
      dollars_over_chart: round2(sum("dollars_over_chart")),
      wtd_dollars_over_chart: round2(sum("wtd_dollars_over_chart")),
      ptd_dollars_over_chart: round2(sum("ptd_dollars_over_chart")),
      hours_over_chart: round2(sum("hours_over_chart")),
      notes_due: rows.filter((r) => r.note_due).length,
      notes_explained: rows.filter((r) => r.explained).length,
      dos,
    },
    stores: rows,
  };
}

// ── Review write ─────────────────────────────────────────────────────
async function saveReview(supa, user, body) {
  if (!REVIEW_ROLES.has(user.role)) {
    return { error: "You don't have permission to add a labor note.", status: 403 };
  }
  const storeNumber = String(body?.store_number || "").trim();
  const businessDate = String(body?.business_date || "").trim();
  const note = String(body?.note ?? "").trim().slice(0, 2000);
  if (!storeNumber) return { error: "store_number is required", status: 400 };
  if (!parseIso(businessDate)) return { error: "valid business_date is required", status: 400 };
  if (!note) return { error: "note is required", status: 400 };

  // Scope check + resolve store_id.
  let storeRow;
  if (user.role === "admin" || ORG_WIDE.has(user.role)) {
    const { data } = await supa.from("stores").select("id, number").eq("number", storeNumber).maybeSingle();
    storeRow = data;
  } else {
    const visible = await resolveVisibleStoreRows(supa, user.id);
    storeRow = visible.find((s) => String(s.number) === storeNumber) || null;
    if (!storeRow) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };
  }
  if (!storeRow) return { error: `Store ${storeNumber} not found.`, status: 404 };

  const now = new Date().toISOString();
  const { data, error } = await supa
    .from("labor_reviews")
    .upsert(
      {
        store_id: storeRow.id,
        store_number: storeNumber,
        business_date: businessDate,
        reviewed_by_id: user.id,
        reviewed_by_email: user.email,
        note,
        acknowledged: true,
        updated_at: now,
      },
      { onConflict: "store_id,business_date" }
    )
    .select("id, note, reviewed_by_email, updated_at")
    .single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, review: data };
}

// ── Sync now (manual trigger) ────────────────────────────────────────
// Auth-gated wrapper that invokes the labor-snapshot function with
// ?force=1, so an admin can pull the current sheet on demand from the UI
// instead of hitting the (unauthenticated) snapshot URL by hand. Returns
// the snapshot summary ({ business_date, upserted, ... }).
async function syncNow(user) {
  if (!SYNC_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const base = (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
  if (!base) return { error: "site URL not configured", status: 500 };
  try {
    const res = await fetch(`${base}/.netlify/functions/labor-snapshot?force=1`, {
      method: "GET",
    });
    const detail = await res.json().catch(() => ({}));
    if (!res.ok) return { error: detail?.error || `snapshot failed (${res.status})`, status: 502 };
    return { ok: true, ...detail };
  } catch (e) {
    return { error: e?.message || "sync failed", status: 502 };
  }
}

// ── HTTP handler ─────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  const params = event.queryStringParameters || {};
  const action = params.action || "my-stores";

  try {
    const supa = admin();

    let user;
    try {
      user = await getSessionUser(event);
    } catch (e) {
      return respond(500, { error: e.message || "auth failed" });
    }
    if (!user) return respond(401, { error: "unauthorized" });

    if (event.httpMethod === "GET") {
      if (action === "gm") return unwrap(await gmView(supa, user, params));
      if (action === "district") return unwrap(await districtView(supa, user, params));
      if (action === "my-stores") return unwrap(await listMyStores(supa, user));
      if (action === "districts") return unwrap(await listDistricts(supa, user));
      if (action === "sync-status") return unwrap(await syncStatus(supa, user));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "review") return unwrap(await saveReview(supa, user, body));
      if (action === "sync-now") return unwrap(await syncNow(user));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
