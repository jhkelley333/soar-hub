// Labor v2 — admin-only labor + sales by store, rolled up onto our org, with
// per-day history. Reads labor_v2_daily (populated by kpi-capture and by the
// refresh action here). Mirrors the KPI dashboard's org roll-up + drill-down.

import { createClient } from "@supabase/supabase-js";
import { resolveOrg } from "./_lib/kpiOrg.js";
import { fetchKpiFeed, kpiConfigured } from "./_lib/kpiFeed.js";
import { extractLaborRows, feedBusinessDate, feedSectionReport, wallClockInTz } from "./_lib/kpiLabor.js";
import { upsertLaborCloses } from "./_lib/laborCloses.js";
import { fiscalForDate } from "./_lib/fiscal.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TZ = "America/Chicago";

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("labor-v2 env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles").select("id, email, full_name, preferred_name, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const numv = (v) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const div = (a, b) => (b ? a / b : null);

// ── GM view: roles, scope, dates ─────────────────────────────────────
// Who can read a store's daily labor, and who can write the explanation note.
const READ_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]);
const REVIEW_ROLES = new Set(["gm", "do", "sdo", "rvp", "admin"]);
const ORG_WIDE = new Set(["payroll", "admin", "vp", "coo"]);
// A day is a "miss" (note due) whenever labor runs over the chart at all —
// if you miss, you miss; no tolerance band. (Same as the OVER CHART badge.)

const roleOf = (u) => String(u?.role || "").toLowerCase();
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (frac) => (frac == null ? null : Number(frac) * 100); // stored fraction → percent points

function pad2(n) { return String(n).padStart(2, "0"); }
function isoOf(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
function shiftDays(d, n) { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
// The Mon–Sun week (7 ISO strings) containing `anchor`.
function weekDates(anchor) {
  const back = (anchor.getUTCDay() + 6) % 7; // days since Monday
  const monday = shiftDays(anchor, -back);
  return Array.from({ length: 7 }, (_, i) => isoOf(shiftDays(monday, i)));
}

// Stores the caller may view labor for (admins/org-wide see all active).
async function resolveVisibleStoreRows(supa, user) {
  if (roleOf(user) === "admin" || ORG_WIDE.has(roleOf(user))) {
    const { data } = await supa.from("stores").select("id, number, name, district_id, is_active").eq("is_active", true).order("number");
    return data ?? [];
  }
  const { data: visibleIds } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visibleIds ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa.from("stores").select("id, number, name, district_id, is_active").in("id", ids).eq("is_active", true).order("number");
  return data ?? [];
}

// Over the chart whenever labor exceeds the target at all (matching the
// displayed, 1-dp variance). Over = a miss; an explanation is required.
function chartStatus(laborPct, goalPct) {
  if (laborPct == null || goalPct == null) return "unknown";
  return round1(laborPct - goalPct) > 0 ? "over" : "on";
}

// Shape one band (prefix "" = daily, "wtd_", "ptd_") into the UI's LaborBand.
// Goal/chart = the feed's target %. $ over chart = cost − sales×target. Hours
// over chart = ($ over chart) ÷ avg store wage, where avg wage = cost ÷ hours.
function shapeBand(row, prefix) {
  if (!row) return null;
  const laborFrac = row[`${prefix}labor_pct`];
  const targetFrac = row[`${prefix}target_labor_pct`];
  const sales = row[`${prefix}net_sales`];
  const cost = row[`${prefix}labor_cost`];
  const hours = row[`${prefix}labor_hours`];
  const laborPct = pct(laborFrac);
  const goalPct = pct(targetFrac);
  const chartAllowed = sales != null && targetFrac != null ? round2(sales * Number(targetFrac)) : null;
  const dollarsOver = cost != null && chartAllowed != null ? round2(Number(cost) - chartAllowed) : null;
  // Avg wage from this band's own cost/hours; convert the $ overage to hours.
  const avgWage = cost != null && hours ? Number(cost) / Number(hours) : null;
  const hoursOver = dollarsOver != null && avgWage ? round1(dollarsOver / avgWage) : null;
  return {
    labor_pct: laborPct == null ? null : round1(laborPct),
    sales: sales ?? null,
    variance_pts: laborPct != null && goalPct != null ? round1(laborPct - goalPct) : null,
    dollars_over_chart: dollarsOver,
    hours_over_chart: hoursOver,
    chart_dollars_allowed: chartAllowed,
    avg_wage: avgWage == null ? null : round2(avgWage),
    status: chartStatus(laborPct, goalPct),
  };
}

// Aggregate one band (prefix "" = daily, "wtd_", "ptd_") across a set of store
// rows, weighting from $ and hours (never averaging percentages). $ over chart =
// cost − sales×target; hours over chart = $ over ÷ blended avg wage (cost÷hours).
function bandAgg(rows, prefix) {
  const s = (k) => rows.reduce((a, r) => a + numv(r[prefix + k]), 0);
  const sales = s("net_sales");
  const cost = s("labor_cost");
  const hours = s("labor_hours");
  const chartAllowed = rows.reduce((a, r) => a + numv(r[prefix + "target_labor_pct"]) * numv(r[prefix + "net_sales"]), 0);
  const laborPct = div(cost, sales);
  const targetPct = div(chartAllowed, sales);
  const dollarsOver = sales ? round2(cost - chartAllowed) : null;
  const avgWage = hours ? cost / hours : null;
  return {
    sales,
    laborPct,
    targetPct,
    variancePts: laborPct != null && targetPct != null ? laborPct - targetPct : null,
    dollarsOver,
    hoursOver: dollarsOver != null && avgWage ? round1(dollarsOver / avgWage) : null,
    chartAllowed: sales ? round2(chartAllowed) : null,
    // Operational hours for the period (Sched / Actual / OT / Act−Sched).
    laborHours: hours,
    scheduledHours: s("scheduled_labor_hours"),
    overtimeHours: s("overtime_hours"),
    actualVsSched: s("actual_vs_scheduled_hours"),
  };
}

// One org node: the three bands (each carries its own sales/labor/hours).
function laborAgg(name, rows) {
  const day = bandAgg(rows, "");
  return {
    name,
    storeCount: rows.length,
    netSales: day.sales, // default sort key (daily sales)
    day,
    wtd: bandAgg(rows, "wtd_"),
    ptd: bandAgg(rows, "ptd_"),
  };
}

function buildLevels(inScope) {
  const groupBy = (keyFn, leaderKey) => {
    const m = new Map();
    for (const r of inScope) {
      const k = keyFn(r) || "Unassigned";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()]
      .map(([name, rs]) => ({
        ...laborAgg(name, rs),
        leader: rs[0]?.soar?.[leaderKey] ?? null,
        region: rs[0]?.soar?.region ?? null,
        area: rs[0]?.soar?.area ?? null,
        district: rs[0]?.soar?.district ?? null,
      }))
      .sort((a, b) => numv(b.netSales) - numv(a.netSales));
  };
  return {
    region: groupBy((r) => r.soar.region, "rvpName"),
    area: groupBy((r) => r.soar.area, "sdoName"),
    district: groupBy((r) => r.soar.district, "doName"),
    store: inScope
      .map((r) => {
        const nm = String(r.soar.store).trim();
        const label = nm.startsWith(r.soar.number) ? nm : `${r.soar.number} ${nm}`;
        return {
          ...laborAgg(label, [r]),
          number: r.soar.number,
          leader: r.soar.gmName,
          district: r.soar.district,
          area: r.soar.area,
          region: r.soar.region,
        };
      })
      .sort((a, b) => numv(b.netSales) - numv(a.netSales)),
  };
}

async function listDates(supa) {
  const { data } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(2000);
  const dates = [...new Set((data || []).map((r) => r.business_date))];
  return { dates };
}

// Pull the feed now and upsert into labor_v2_daily; returns the business date.
async function refreshNow(supa) {
  if (!kpiConfigured()) throw new Error("KPI feed isn't configured.");
  const payload = await fetchKpiFeed();
  const wc = wallClockInTz(new Date(), TZ);
  const businessDate = feedBusinessDate(payload, wc);
  const extracted = extractLaborRows(payload);
  const rows = extracted.map((r) => ({ ...r, business_date: businessDate, captured_at: new Date().toISOString() }));
  if (rows.length) {
    const { error } = await supa.from("labor_v2_daily").upsert(rows, { onConflict: "store_number,business_date" });
    // Surface write failures instead of swallowing them — a missing column
    // (e.g. migration 0187 not applied) would otherwise leave stale rows with
    // no signal. The Postgres message names the offending column.
    if (error) throw new Error(`Couldn't save labor rows: ${error.message}`);
  }
  // If this business date closes a fiscal week / period, snapshot the final
  // WTD / PTD into the close ledgers (idempotent).
  try { await upsertLaborCloses(supa, extracted, businessDate); }
  catch (e) { console.log(`[labor-v2] close snapshot failed: ${e.message}`); }
  // Report how many rows carried each band, so the UI can confirm WTD/PTD
  // actually came through the feed (vs. a silent extraction miss).
  const report = feedSectionReport(payload);
  const counts = {
    stores: extracted.length,
    wtd: extracted.filter((r) => r.wtd_net_sales != null).length,
    ptd: extracted.filter((r) => r.ptd_net_sales != null).length,
    feedKeys: report.feedKeys,
  };
  return { businessDate, counts };
}

async function summary(supa, params) {
  let date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;

  // Refresh from the live feed when asked, or when there's no history yet.
  let refreshed = null;
  if (params.refresh === "1" || !date) {
    const { data: anyRow } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1);
    if (params.refresh === "1" || !anyRow?.length) {
      try { const r = await refreshNow(supa); if (!date) date = r.businessDate; refreshed = r.counts; }
      catch (e) { if (!anyRow?.length) return { error: e.message, status: 502 }; throw e; }
    }
    if (!date) date = anyRow?.[0]?.business_date ?? null;
  }
  if (!date) return { date: null, total: null, scope: { matched: 0, unmatched: 0 }, levels: { region: [], area: [], district: [], store: [] } };

  const { data: rows } = await supa.from("labor_v2_daily").select("*").eq("business_date", date);
  const numbers = [...new Set((rows || []).map((r) => String(r.store_number)).filter(Boolean))];
  const orgMap = await resolveOrg(supa, numbers);

  let matched = 0;
  const unmatched = [];
  const inScope = [];
  for (const r of rows || []) {
    const org = orgMap.get(String(r.store_number));
    if (org) { matched++; inScope.push({ ...r, soar: org }); }
    else unmatched.push(String(r.store_number));
  }

  const total = laborAgg("Company", inScope);
  return {
    date,
    total,
    refreshed,
    scope: { matched, unmatched: unmatched.length, unmatchedSample: unmatched.slice(0, 10) },
    levels: buildLevels(inScope),
  };
}

// Most recent business_date we have any row for (the default "yesterday").
async function latestBusinessDate(supa) {
  const { data } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1).maybeSingle();
  return data?.business_date ?? null;
}

// Stores the caller can pick from in the GM view (the store dropdown).
async function listMyStores(supa, user) {
  if (!READ_ROLES.has(roleOf(user))) return { stores: [] };
  const rows = await resolveVisibleStoreRows(supa, user);
  return { stores: rows.map((s) => ({ id: s.id, number: s.number, name: s.name, district_id: s.district_id })) };
}

// GM day view for one store: Daily / WTD / PTD bands + week strip + note state.
async function gmView(supa, user, params) {
  if (!READ_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  if (!storeNumber) return { error: "store is required", status: 400 };

  // Scope check (admins/org-wide can view any store).
  let storeRow = null;
  if (roleOf(user) === "admin" || ORG_WIDE.has(roleOf(user))) {
    const { data } = await supa.from("stores").select("id, number, name, district_id").eq("number", storeNumber).maybeSingle();
    storeRow = data;
  } else {
    const visible = await resolveVisibleStoreRows(supa, user);
    storeRow = visible.find((s) => String(s.number) === storeNumber) || null;
    if (!storeRow) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };
  }
  if (!storeRow) return { error: `Store ${storeNumber} not found.`, status: 404 };

  const anchorIso = params.date || (await latestBusinessDate(supa));
  if (!anchorIso) return { store: storeRow, date: null, day: null, wtd: null, ptd: null, week: [], goal: null, notes_due: 0 };
  const anchor = parseIso(anchorIso);
  if (!anchor) return { error: "bad date", status: 400 };

  const week = weekDates(anchor);
  const [{ data: rows }, { data: reviews }] = await Promise.all([
    supa.from("labor_v2_daily").select("*").eq("store_number", storeNumber).gte("business_date", week[0]).lte("business_date", week[6]),
    supa.from("labor_reviews").select("*").eq("store_number", storeNumber).gte("business_date", week[0]).lte("business_date", week[6]),
  ]);
  const rowByDate = new Map((rows ?? []).map((r) => [r.business_date, r]));
  const reviewByDate = new Map((reviews ?? []).map((r) => [r.business_date, r]));

  const anchorRow = rowByDate.get(anchorIso) || null;
  // Headline goal = PTD target if present, else the day's target.
  const goalPct = pct(anchorRow?.ptd_target_labor_pct ?? anchorRow?.target_labor_pct ?? null);

  const shapeDay = (row, review) => {
    if (!row) return null;
    const band = shapeBand(row, "");
    const explained = !!review;
    return {
      ...band,
      business_date: row.business_date,
      note_due: band.status === "over" && !explained,
      explained,
      review: review ? { note: review.note, by: review.reviewed_by_email, at: review.updated_at } : null,
    };
  };

  const weekStrip = week.map((iso) => {
    const r = rowByDate.get(iso);
    const laborPct = r ? pct(r.labor_pct) : null;
    const status = r ? chartStatus(laborPct, pct(r.target_labor_pct)) : "missing";
    return {
      business_date: iso,
      labor_pct: laborPct == null ? null : round1(laborPct),
      status,
      note_due: status === "over" && !reviewByDate.get(iso),
    };
  });

  return {
    store: { number: storeRow.number, name: storeRow.name, district_id: storeRow.district_id },
    date: anchorIso,
    goal: goalPct == null ? null : round1(goalPct),
    goal_source: "store chart target",
    gm_name: null,
    day: shapeDay(anchorRow, reviewByDate.get(anchorIso)),
    wtd: shapeBand(anchorRow, "wtd_"),
    ptd: shapeBand(anchorRow, "ptd_"),
    week: weekStrip,
    notes_due: weekStrip.filter((d) => d.note_due).length,
  };
}

// Upsert the GM's explanation note into labor_reviews (the existing notes
// schema, shared with the original /labor tab).
async function saveReview(supa, user, body) {
  if (!REVIEW_ROLES.has(roleOf(user))) return { error: "You don't have permission to add a labor note.", status: 403 };
  const storeNumber = String(body?.store_number || "").trim();
  const businessDate = String(body?.business_date || "").trim();
  const note = String(body?.note ?? "").trim().slice(0, 2000);
  if (!storeNumber) return { error: "store_number is required", status: 400 };
  if (!parseIso(businessDate)) return { error: "valid business_date is required", status: 400 };
  if (!note) return { error: "note is required", status: 400 };

  let storeRow;
  if (roleOf(user) === "admin" || ORG_WIDE.has(roleOf(user))) {
    const { data } = await supa.from("stores").select("id, number").eq("number", storeNumber).maybeSingle();
    storeRow = data;
  } else {
    const visible = await resolveVisibleStoreRows(supa, user);
    storeRow = visible.find((s) => String(s.number) === storeNumber) || null;
    if (!storeRow) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };
  }
  if (!storeRow) return { error: `Store ${storeNumber} not found.`, status: 404 };

  const now = new Date().toISOString();
  const { data, error } = await supa.from("labor_reviews").upsert(
    { store_id: storeRow.id, store_number: storeNumber, business_date: businessDate, reviewed_by_id: user.id, reviewed_by_email: user.email, note, acknowledged: true, updated_at: now },
    { onConflict: "store_id,business_date" },
  ).select("id, note, reviewed_by_email, updated_at").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, review: data };
}

// One-time/again-safe backfill: walk existing labor_v2_daily and snapshot a
// close for every business_date that is a fiscal week / period end. Lets the
// close ledgers pick up weeks/periods that closed before this feature shipped.
async function backfillCloses(supa) {
  const { data: dateRows } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: true }).limit(5000);
  const dates = [...new Set((dateRows || []).map((r) => r.business_date))];
  const closeDates = dates.filter((d) => { const fi = fiscalForDate(d); return fi && (fi.isWeekEnd || fi.isPeriodEnd); });
  let weeks = 0;
  let periods = 0;
  for (const d of closeDates) {
    const { data: rows } = await supa.from("labor_v2_daily").select("*").eq("business_date", d);
    const r = await upsertLaborCloses(supa, rows || [], d);
    weeks += r.weeks;
    periods += r.periods;
  }
  return { scannedDates: dates.length, closeDates: closeDates.length, weeksWritten: weeks, periodsWritten: periods };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); }
  catch (e) { return respond(500, { error: e.message }); }

  let user;
  try { user = await getSessionUser(supa, event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "summary";
  const isAdmin = roleOf(user) === "admin";
  const unwrap = (out) => (out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out }));

  try {
    // POST — GM/DO note write (shared labor_reviews schema).
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "review") return unwrap(await saveReview(supa, user, body));
      return respond(400, { error: `Unknown action: ${action}` });
    }

    // GM-facing reads — scope enforced per store in the function.
    if (action === "gm") return unwrap(await gmView(supa, user, params));
    if (action === "my-stores") return unwrap(await listMyStores(supa, user));

    // Admin-only org rollup.
    if (!isAdmin) return respond(403, { error: "Admins only." });
    if (action === "dates") return respond(200, await listDates(supa));
    if (action === "backfill-closes") return unwrap(await backfillCloses(supa));
    if (action === "summary") {
      const out = await summary(supa, params);
      if (out?.error) return respond(out.status || 500, { error: out.error });
      return respond(200, { ok: true, ...out });
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: `labor-v2 error: ${e?.message || String(e)}` });
  }
};
