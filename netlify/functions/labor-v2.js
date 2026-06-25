// Labor v2 — admin-only labor + sales by store, rolled up onto our org, with
// per-day history. Reads labor_v2_daily (populated by kpi-capture and by the
// refresh action here). Mirrors the KPI dashboard's org roll-up + drill-down.

import { createClient } from "@supabase/supabase-js";
import { resolveOrg } from "./_lib/kpiOrg.js";
import { fetchKpiFeed, kpiConfigured } from "./_lib/kpiFeed.js";
import { extractLaborRows, feedBusinessDate, feedSectionReport, wallClockInTz } from "./_lib/kpiLabor.js";
import { upsertLaborCloses } from "./_lib/laborCloses.js";
import { fiscalForDate } from "./_lib/fiscal.js";
import { loadTrainingCreditDates, applyCreditsToRows } from "./_lib/trainingCredit.js";
import { logPull } from "./_lib/pullLog.js";

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
    training_credit: round2((row._tc?.[prefix === "" ? "day" : prefix === "wtd_" ? "wtd" : "ptd"]?.amt) ?? 0),
    status: chartStatus(laborPct, goalPct),
  };
}

// One store's hours over chart for a band ($ over ÷ that store's avg wage).
// Returns null when the store has no real daily basis (missing sales / labor /
// target) — such stores are excluded from the Hrs/Unit average entirely.
function storeHoursOver(r, prefix) {
  const cost = numv(r[prefix + "labor_cost"]);
  const hours = numv(r[prefix + "labor_hours"]);
  const sales = numv(r[prefix + "net_sales"]);
  const target = numv(r[prefix + "target_labor_pct"]);
  if (!sales || !cost || !hours || !target) return null;
  const chartAllowed = sales * target;
  return (cost - chartAllowed) / (cost / hours);
}

// Hrs/Unit: at the store level, the store's own hours over — but only if it's
// over (negative/under is hidden). At District and above it's the average over
// ALL the node's stores (its children): only the OVER stores' hours feed the
// sum, but you divide by every store — under, on-chart, and no-data stores all
// count in the denominator and add 0 to the sum.
function hoursPerUnit(rows, prefix) {
  if (rows.length === 1) {
    const h = storeHoursOver(rows[0], prefix);
    return h != null && h > 0 ? round2(h) : null;
  }
  const posSum = rows.reduce((a, r) => { const h = storeHoursOver(r, prefix); return a + (h && h > 0 ? h : 0); }, 0);
  return round2(posSum / rows.length);
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
  return {
    sales,
    laborPct,
    targetPct,
    variancePts: laborPct != null && targetPct != null ? laborPct - targetPct : null,
    dollarsOver,
    hoursOver: hoursPerUnit(rows, prefix),
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
// ctx = { source, triggeredBy } for the pull log.
async function refreshNow(supa, ctx = {}) {
  const started = Date.now();
  const source = ctx.source || "refresh";
  try {
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
    await logPull(supa, { source, ok: true, business_date: businessDate, store_rows: counts.stores, wtd_rows: counts.wtd, ptd_rows: counts.ptd, triggered_by: ctx.triggeredBy, duration_ms: Date.now() - started });
    return { businessDate, counts };
  } catch (e) {
    await logPull(supa, { source, ok: false, error: e.message, triggered_by: ctx.triggeredBy, duration_ms: Date.now() - started });
    throw e;
  }
}

// Recent pull-log rows for the admin log page.
async function pullLog(supa) {
  const { data } = await supa.from("kpi_pull_log").select("*").order("created_at", { ascending: false }).limit(200);
  return { entries: data || [] };
}

async function summary(supa, params, user) {
  let date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;

  // Refresh from the live feed when asked, when there's no history yet, or when
  // the latest data is stale (the scheduled capture missed — self-heal).
  let refreshed = null;
  if (params.refresh === "1" || !date) {
    const { data: anyRow } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1);
    const latest = anyRow?.[0]?.business_date ?? null;
    const wc = wallClockInTz(new Date(), TZ);
    const yest = new Date(Date.UTC(wc.year, wc.month - 1, wc.day)); yest.setUTCDate(yest.getUTCDate() - 1);
    const expected = yest.toISOString().slice(0, 10); // feed serves the previous business day
    const stale = !latest || latest < expected;
    if (params.refresh === "1" || stale) {
      const ctx = { source: params.refresh === "1" ? "refresh" : "self-heal", triggeredBy: user?.email };
      try { const r = await refreshNow(supa, ctx); if (!date) date = r.businessDate; refreshed = r.counts; }
      catch (e) { if (!latest) return { error: e.message, status: 502 }; /* keep serving stale data */ }
    }
    if (!date) date = latest;
  }
  if (!date) return { date: null, total: null, scope: { matched: 0, unmatched: 0 }, levels: { region: [], area: [], district: [], store: [] } };

  const { data: rows } = await supa.from("labor_v2_daily").select("*").eq("business_date", date);
  const numbers = [...new Set((rows || []).map((r) => String(r.store_number)).filter(Boolean))];
  applyCreditsToRows(rows || [], await loadTrainingCreditDates(supa, numbers));
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
  applyCreditsToRows(rows ?? [], await loadTrainingCreditDates(supa, [storeNumber]));
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

// ── Leadership rollup ("Team labor") ─────────────────────────────────
// Scoped to the caller's stores (DO → district, SDO → market/area, RVP →
// region). Returns scope totals, a rollup at the chosen level, and the flat
// store list with note status — the data points from the admin rollup plus the
// notes-to-review workflow.
const TEAM_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);
const LEVEL_CFG = {
  region: { key: (r) => r.soar.region, leader: "rvpName" },
  area: { key: (r) => r.soar.area, leader: "sdoName" },     // "Market"
  district: { key: (r) => r.soar.district, leader: "doName" },
};

// Percent-based band for one store ([r]) or a group of rows. labor_pct /
// target_pct in percent points; $ over / hours over absolute.
function teamBand(rows, prefix) {
  const s = (k) => rows.reduce((a, r) => a + numv(r[prefix + k]), 0);
  const sales = s("net_sales");
  const cost = s("labor_cost");
  const hours = s("labor_hours");
  const chartAllowed = rows.reduce((a, r) => a + numv(r[prefix + "target_labor_pct"]) * numv(r[prefix + "net_sales"]), 0);
  const laborPct = sales ? round1((cost / sales) * 100) : null;
  const targetPct = sales ? round1((chartAllowed / sales) * 100) : null;
  const dollarsOver = sales ? round2(cost - chartAllowed) : null;
  const tcKey = prefix === "" ? "day" : prefix === "wtd_" ? "wtd" : "ptd";
  const trainingCredit = round2(rows.reduce((a, r) => a + numv(r._tc?.[tcKey]?.amt), 0));
  return {
    labor_pct: laborPct,
    target_pct: targetPct,
    variance_pts: laborPct != null && targetPct != null ? round1(laborPct - targetPct) : null,
    dollars_over_chart: dollarsOver,
    hours_over_chart: hoursPerUnit(rows, prefix),
    scheduled_hours: s("scheduled_labor_hours"),
    actual_hours: hours,
    overtime_hours: s("overtime_hours"),
    act_vs_sched: s("actual_vs_scheduled_hours"),
    training_credit: trainingCredit,
    status: chartStatus(laborPct, targetPct),
  };
}

async function teamView(supa, user, params) {
  if (!TEAM_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const empty = { date: null, scope: { stores: 0, dos: [] }, totals: null, startLevel: "district", levels: { region: [], area: [], district: [], store: [] }, missing: [] };

  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.length) return empty;
  const numbers = [...new Set(visible.map((s) => String(s.number)))];

  const anchor = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : await latestBusinessDate(supa);
  if (!anchor) return empty;

  const [{ data: rows }, { data: reviews }] = await Promise.all([
    supa.from("labor_v2_daily").select("*").eq("business_date", anchor).in("store_number", numbers),
    supa.from("labor_reviews").select("store_number, note").eq("business_date", anchor).in("store_number", numbers),
  ]);
  applyCreditsToRows(rows || [], await loadTrainingCreditDates(supa, numbers));
  const reviewByStore = new Map((reviews || []).map((r) => [String(r.store_number), r]));
  const orgMap = await resolveOrg(supa, numbers);

  // Visible stores with no Expressway poll for this date (no row, or a row
  // with no daily sales) — surfaced so the numbers can be flagged as skewed.
  const polled = new Set((rows || []).filter((r) => r.net_sales != null).map((r) => String(r.store_number)));
  const missing = visible
    .filter((s) => !polled.has(String(s.number)))
    .map((s) => ({ number: String(s.number), name: s.name }))
    .sort((a, b) => a.number.localeCompare(b.number));

  const inScope = [];
  for (const r of rows || []) {
    const soar = orgMap.get(String(r.store_number));
    if (soar) inScope.push({ ...r, soar });
  }
  if (!inScope.length) return { ...empty, date: anchor, missing };

  const storeOver = (r) => teamBand([r], "").status === "over";

  // Group rollup at one level (region/area/district), carrying parent names so
  // the client can filter the drill path.
  const groupLevel = (lvl) => {
    const m = new Map();
    for (const r of inScope) {
      const k = LEVEL_CFG[lvl].key(r) || "Unassigned";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].map(([name, rs]) => ({
      name,
      leader: rs[0]?.soar?.[LEVEL_CFG[lvl].leader] ?? null,
      storeCount: rs.length,
      region: rs[0]?.soar?.region ?? null,
      area: rs[0]?.soar?.area ?? null,
      district: rs[0]?.soar?.district ?? null,
      day: teamBand(rs, ""), wtd: teamBand(rs, "wtd_"), ptd: teamBand(rs, "ptd_"),
      storesOver: rs.filter(storeOver).length,
      notesDue: rs.filter((r) => storeOver(r) && !reviewByStore.get(String(r.store_number))).length,
    })).sort((a, b) => (b.day.variance_pts ?? -999) - (a.day.variance_pts ?? -999));
  };

  const storeRows = inScope.map((r) => {
    const review = reviewByStore.get(String(r.store_number));
    const explained = !!review;
    const day = teamBand([r], "");
    const nm = String(r.soar.store).trim();
    return {
      store_number: r.soar.number,
      store_name: nm.replace(new RegExp(`^\\s*${r.soar.number}\\s*`), ""),
      gm_name: r.soar.gmName,
      do_name: r.soar.doName,
      region: r.soar.region, area: r.soar.area, district: r.soar.district,
      day, wtd: teamBand([r], "wtd_"), ptd: teamBand([r], "ptd_"),
      status: day.status,
      note_due: day.status === "over" && !explained,
      explained,
      note: review?.note ?? null,
    };
  }).sort((a, b) => (b.day.variance_pts ?? -999) - (a.day.variance_pts ?? -999));

  const levels = { region: groupLevel("region"), area: groupLevel("area"), district: groupLevel("district"), store: storeRows };
  // Start the drill at the broadest level with more than one node (else the
  // lowest non-store level), so a single-node chain isn't a dead click.
  let startLevel = "district";
  for (const lv of ["region", "area", "district"]) { if (levels[lv].length > 1) { startLevel = lv; break; } }

  return {
    date: anchor,
    scope: { stores: inScope.length, dos: [...new Set(inScope.map((r) => r.soar.doName).filter(Boolean))] },
    totals: {
      day: teamBand(inScope, ""), wtd: teamBand(inScope, "wtd_"), ptd: teamBand(inScope, "ptd_"),
      storesOver: storeRows.filter((s) => s.status === "over").length,
      notesDue: storeRows.filter((s) => s.note_due).length,
      notesExplained: storeRows.filter((s) => s.explained).length,
    },
    startLevel,
    levels,
    missing,
  };
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
    if (action === "team") return unwrap(await teamView(supa, user, params));
    if (action === "my-stores") return unwrap(await listMyStores(supa, user));

    // Admin-only org rollup.
    if (!isAdmin) return respond(403, { error: "Admins only." });
    if (action === "dates") return respond(200, await listDates(supa));
    if (action === "pull-log") return respond(200, { ok: true, ...(await pullLog(supa)) });
    if (action === "backfill-closes") return unwrap(await backfillCloses(supa));
    if (action === "summary") {
      const out = await summary(supa, params, user);
      if (out?.error) return respond(out.status || 500, { error: out.error });
      return respond(200, { ok: true, ...out });
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: `labor-v2 error: ${e?.message || String(e)}` });
  }
};
