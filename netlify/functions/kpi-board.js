// /admin/kpi — Execution Metrics Board data. Scope-selectable (company /
// region / store) board of Daily / WTD / MTD values with a prior-period
// comparison and a trailing 5-week weekly trend, per metric. The rich metrics
// come from labor_v2_daily's banded columns (net_sales, labor, on-time,
// tickets, prev-year, all with wtd_/ptd_) and count_daily (inventory-count
// scores + IntelliCost). Metrics with no source yet return null (the board
// renders them in a skeleton state). One value set per scope selection.
import { createClient } from "@supabase/supabase-js";
import { fiscalForDate } from "./_lib/fiscal.js";
import { resolveOrg } from "./_lib/kpiOrg.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOARD_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);
const DAY = 86400000;
const numv = (v) => (typeof v === "number" && isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0);
const parseIso = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : null);
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const shiftDays = (ms, n) => ms + n * DAY;

function respond(status, body) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function userFromAuth(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  const { data: { user } = {} } = await supa.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supa.from("profiles").select("id, role, email").eq("id", user.id).maybeSingle();
  return profile ? { id: profile.id, role: String(profile.role || "").toLowerCase(), email: profile.email } : null;
}

// ── metric aggregators over a set of labor_v2_daily rows for a band prefix ────
const sumOf = (rows, k) => rows.reduce((a, r) => a + numv(r[k]), 0);
const div = (a, b) => (b ? a / b : null);

function laborMetrics(rows, p) {
  const sales = sumOf(rows, `${p}net_sales`);
  const cost = sumOf(rows, `${p}labor_cost`);
  const hours = sumOf(rows, `${p}labor_hours`);
  const tickets = sumOf(rows, `${p}tickets`);
  const otNum = sumOf(rows, `${p}on_time_numerator`);
  const otDen = sumOf(rows, `${p}on_time_denominator`);
  const lyS = sumOf(rows, `${p}prev_year_net_sales`);
  return {
    sales_vs_ly: lyS ? ((sales - lyS) / lyS) * 100 : null,
    labor_pct: sales ? (cost / sales) * 100 : null,
    splh: div(sales, hours),
    tickets: rows.length ? tickets : null,
    average_check: div(sales, tickets),
    on_time: otDen ? (otNum / otDen) * 100 : null,
    actual_vs_schedule: rows.length ? sumOf(rows, `${p}actual_vs_scheduled_hours`) : null,
    overtime: rows.length ? sumOf(rows, `${p}overtime_hours`) : null,
  };
}

function countMetrics(rows) {
  if (!rows.length) return { cogs_pct: null, daily_score: null, completion_score: null, accuracy_score: null };
  const avgPct = (k) => {
    const vals = rows.map((r) => r[k]).filter((v) => typeof v === "number" && isFinite(v));
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100 : null;
  };
  return {
    cogs_pct: avgPct("total_intellicost_pct"),
    daily_score: avgPct("daily_score"),
    completion_score: avgPct("completion_score"),
    accuracy_score: avgPct("accuracy_score"),
  };
}

// All metric ids the board knows; every value slot defaults to null so the
// frontend can rely on the shape and render skeletons for unwired metrics.
const METRIC_IDS = [
  "sales_vs_ly", "avg_ticket_time", "on_time", "vog", "complaints", "order_accuracy", "delivery_mix", "splh", "tickets", "average_check",
  "l2r", "vog2", "complaints_rank", "mystery_shop_rank", "ecosure_rank",
  "labor_pct", "actual_vs_schedule", "overtime",
  "cogs_pct", "daily_score", "completion_score", "accuracy_score", "count_variance", "item_efficiency",
  "other_pct", "cash_over_short", "paid_outs", "last_clock_out",
  "training_compliance", "new_hire_certified", "cross_trained", "ninety_day_retention",
];

export const handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "kpi-board env vars not configured" });
    const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const user = await userFromAuth(supa, event);
    if (!user) return respond(401, { error: "unauthorized" });
    if (!BOARD_ROLES.has(user.role)) return respond(403, { error: "Not authorized." });

    const params = event.queryStringParameters || {};
    const level = ["company", "region", "store"].includes(params.level) ? params.level : "company";
    const id = params.id ? String(params.id) : null;

    // Latest business date anchors the whole board.
    const { data: latest } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1);
    const anchor = latest?.[0]?.business_date ?? null;
    if (!anchor) return respond(200, { anchor: null, fiscal: null, scopes: { regions: [], stores: [] }, values: emptyValues() });

    // Org: build the scope selector lists + resolve which stores are in scope.
    const { data: allStores } = await supa.from("labor_v2_daily").select("store_number").eq("business_date", anchor);
    const numbers = [...new Set((allStores || []).map((r) => String(r.store_number)))];
    const orgMap = await resolveOrg(supa, numbers);
    const regions = [...new Set(numbers.map((n) => orgMap.get(n)?.region).filter(Boolean))].sort();
    const storeList = numbers
      .map((n) => ({ number: n, name: orgMap.get(n)?.store || `#${n}`, region: orgMap.get(n)?.region || null }))
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

    let scopeStores = numbers;
    if (level === "region" && id) scopeStores = numbers.filter((n) => orgMap.get(n)?.region === id);
    else if (level === "store" && id) scopeStores = numbers.filter((n) => n === id);

    const scopes = { regions, stores: storeList };
    if (!scopeStores.length) return respond(200, { anchor, fiscal: fiscalForDate(anchor), scopes, values: emptyValues() });

    // Dates we need: anchor + prior-day + prior-week + prior-period, and the 5
    // trailing fiscal week-ends for the weekly trend.
    const fi = fiscalForDate(anchor);
    const dailyPrior = isoOf(shiftDays(parseIso(anchor), -1));
    const wtdPrior = isoOf(shiftDays(parseIso(anchor), -7));
    const mtdPrior = isoOf(shiftDays(parseIso(anchor), -28));
    const baseEnd = fi ? (fi.weekEnd <= anchor ? fi.weekEnd : isoOf(shiftDays(parseIso(fi.weekStart), -1))) : anchor;
    const weekEnds = Array.from({ length: 5 }, (_, i) => isoOf(shiftDays(parseIso(baseEnd), -7 * (4 - i)))); // oldest..newest
    const dates = [...new Set([anchor, dailyPrior, wtdPrior, mtdPrior, ...weekEnds])];

    // Per-date fetch (keeps each query under the row cap even at company scope).
    const laborByDate = new Map();
    const countByDate = new Map();
    await Promise.all(dates.map(async (d) => {
      const [{ data: lab }, { data: cnt }] = await Promise.all([
        supa.from("labor_v2_daily").select("*").eq("business_date", d).in("store_number", scopeStores),
        supa.from("count_daily").select("store_number, daily_score, completion_score, accuracy_score, total_intellicost_pct").eq("business_date", d).in("store_number", scopeStores),
      ]);
      laborByDate.set(d, lab || []);
      countByDate.set(d, cnt || []);
    }));

    const lab = (d, p) => laborMetrics(laborByDate.get(d) || [], p);
    const cnt = (d) => countMetrics(countByDate.get(d) || []);

    // Assemble each metric id's { daily:[c,p], wtd:[c,p], mtd:[c,p], weeks:[5] }.
    const values = emptyValues();
    const laborAnchorD = lab(anchor, ""), laborAnchorW = lab(anchor, "wtd_"), laborAnchorM = lab(anchor, "ptd_");
    const laborPriorD = lab(dailyPrior, ""), laborPriorW = lab(wtdPrior, "wtd_"), laborPriorM = lab(mtdPrior, "ptd_");
    const laborWeeks = weekEnds.map((d) => lab(d, "wtd_"));
    for (const k of ["sales_vs_ly", "on_time", "splh", "tickets", "average_check", "labor_pct", "actual_vs_schedule", "overtime"]) {
      values[k] = {
        daily: pair(laborAnchorD[k], laborPriorD[k]),
        wtd: pair(laborAnchorW[k], laborPriorW[k]),
        mtd: pair(laborAnchorM[k], laborPriorM[k]),
        weeks: laborWeeks.map((w) => round(w[k])),
      };
    }

    // Count-based metrics are daily snapshots (no bands): use the anchor day for
    // all three periods, prior = prior day, weekly trend from the 5 week-ends.
    const cAnchor = cnt(anchor), cPrior = cnt(dailyPrior);
    const cWeeks = weekEnds.map((d) => cnt(d));
    for (const k of ["cogs_pct", "daily_score", "completion_score", "accuracy_score"]) {
      values[k] = {
        daily: pair(cAnchor[k], cPrior[k]),
        wtd: pair(cAnchor[k], cPrior[k]),
        mtd: pair(cAnchor[k], cPrior[k]),
        weeks: cWeeks.map((w) => round(w[k])),
      };
    }

    return respond(200, { anchor, fiscal: fi, scope: { level, id }, scopes, values });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
}

function round(v) { return v == null || !isFinite(v) ? null : Math.round(v * 100) / 100; }
function pair(cur, prior) { return [round(cur), round(prior)]; }
function emptyValues() {
  const o = {};
  for (const id of METRIC_IDS) o[id] = { daily: [null, null], wtd: [null, null], mtd: [null, null], weeks: [null, null, null, null, null] };
  return o;
}
