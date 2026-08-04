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

// Weighted mean of column `valKey` by column `wtKey` across rows (both numeric).
function weightedMean(rows, valKey, wtKey) {
  let num = 0, wt = 0;
  for (const r of rows) {
    const v = numv(r[valKey]), w = numv(r[wtKey]);
    if (v && w) { num += v * w; wt += w; }
  }
  return wt ? num / wt : null;
}

function laborMetrics(rows, p) {
  const sales = sumOf(rows, `${p}net_sales`);
  const cost = sumOf(rows, `${p}labor_cost`);
  const hours = sumOf(rows, `${p}labor_hours`);
  const tickets = sumOf(rows, `${p}tickets`);
  const otNum = sumOf(rows, `${p}on_time_numerator`);
  const otDen = sumOf(rows, `${p}on_time_denominator`);
  const lyS = sumOf(rows, `${p}prev_year_net_sales`);
  const ttTotal = sumOf(rows, `${p}total_ticket_time`);
  const ttQty = sumOf(rows, `${p}on_time_quantity`);
  // Avg Ticket Time = the feed's averageTicketTime, ticket-weighted across the
  // scope; fall back to total_ticket_time / on_time_quantity if not captured.
  const attWeighted = weightedMean(rows, `${p}average_ticket_time`, `${p}tickets`);
  // Labor target from the feed (sales-weighted targetLaborPercentage). Normalize
  // a fraction (0.26) to a percent (26) so it lines up with labor_pct.
  let laborTarget = weightedMean(rows, `${p}target_labor_pct`, `${p}net_sales`);
  if (laborTarget != null && laborTarget < 1) laborTarget *= 100;
  return {
    sales_vs_ly: lyS ? ((sales - lyS) / lyS) * 100 : null,
    sales_dollars: rows.length ? sales : null,
    ly_dollars: rows.length ? lyS : null,
    labor_pct: sales ? (cost / sales) * 100 : null,
    labor_target: laborTarget,
    splh: div(sales, hours),
    tickets: rows.length ? tickets : null,
    average_check: div(sales, tickets),
    on_time: otDen ? (otNum / otDen) * 100 : null,
    avg_ticket_time: attWeighted != null ? attWeighted : (ttQty ? ttTotal / ttQty : null),
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

// Ranker-sourced board metrics from the latest completed run ("LW Ranker"),
// aggregated across the scope's stores. All are 0-1 fractions in the ranker and
// shown as percentages here (matching the ranking board). VOG is response-
// weighted by its poll count; EcoSure + Mystery Shop (Shop avg) are simple
// averages of the numeric store values (they can be 'No Audit' / 'NEW SDO').
// EcoSure + Mystery Shop are period (PTD) metrics — WTD carries no value — so
// the PTD figure is used for every board window.
const rankerNum = (v) => (typeof v === "number" && isFinite(v) ? v : null);
async function rankerMetrics(supa, scopeStoreNumbers, anchor = null) {
  const empty = { vog: { wtd: null, ptd: null }, ecosure: null, mysteryShop: null };
  const numset = new Set((scopeStoreNumbers || []).map(String));
  if (!numset.size) return empty;
  let q = supa.from("ranking_runs").select("id").eq("status", "complete");
  // Viewing a past week → use the newest run that ended on/before the anchor.
  if (anchor) q = q.lte("week_ending", anchor);
  const { data: runs } = await q
    .order("week_ending", { ascending: false })
    .order("started_at", { ascending: false }).limit(1);
  const runId = runs?.[0]?.id;
  if (!runId) return empty;

  const out = { vog: { wtd: null, ptd: null }, ecosure: null, mysteryShop: null };
  const byScope = {};
  await Promise.all(["wtd", "ptd"].map(async (scope) => {
    const { data: rows } = await supa
      .from("ranking_rows").select("entity_key, metrics")
      .eq("run_id", runId).eq("scope", scope).eq("tier", "store");
    byScope[scope] = (rows || []).filter((r) => numset.has(String(r.entity_key)));
  }));

  // VOG — response-weighted, per scope, 0-1 -> %.
  for (const scope of ["wtd", "ptd"]) {
    let wSum = 0, rSum = 0, plain = 0, n = 0;
    for (const r of byScope[scope] || []) {
      const m = r.metrics || {};
      const v = rankerNum(m.vog);
      if (v == null) continue;
      const resp = rankerNum(m.vogResponses) ?? 0;
      wSum += v * resp; rSum += resp; plain += v; n += 1;
    }
    if (n) out.vog[scope] = (rSum > 0 ? wSum / rSum : plain / n) * 100;
  }

  // EcoSure + Mystery Shop — PTD only, simple average of numeric values, 0-1 -> %.
  const avgPct = (key) => {
    const vals = (byScope.ptd || []).map((r) => rankerNum((r.metrics || {})[key])).filter((v) => v != null);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100 : null;
  };
  out.ecosure = avgPct("ecosure");
  out.mysteryShop = avgPct("msScore");
  return out;
}

export const handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "kpi-board env vars not configured" });
    const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const user = await userFromAuth(supa, event);
    if (!user) return respond(401, { error: "unauthorized" });
    if (!BOARD_ROLES.has(user.role)) return respond(403, { error: "Not authorized." });

    const params = event.queryStringParameters || {};

    // Admin: set/clear a metric's target override.
    if (event.httpMethod === "POST" && params.action === "set-target") {
      if (user.role !== "admin") return respond(403, { error: "Only an admin can change targets." });
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
      const metricId = String(body.metric_id || "").trim();
      if (!metricId) return respond(400, { error: "metric_id is required" });
      const target = body.target === null || body.target === "" ? null : Number(body.target);
      if (target != null && !isFinite(target)) return respond(400, { error: "target must be a number or null" });
      const { error } = await supa.from("board_metric_targets").upsert(
        { metric_id: metricId, target, updated_by: user.id, updated_at: new Date().toISOString() },
        { onConflict: "metric_id" },
      );
      if (error) {
        if (/board_metric_targets/.test(error.message)) return respond(500, { error: "Run migration 0275 first (board_metric_targets is missing)." });
        return respond(500, { error: error.message });
      }
      return respond(200, { ok: true, metric_id: metricId, target });
    }

    const level = ["company", "region", "store"].includes(params.level) ? params.level : "company";
    const id = params.id ? String(params.id) : null;

    // Anchor date: an explicit ?date=YYYY-MM-DD (view a past week) or the latest
    // captured business date. Clamp a requested future/absent date to the latest.
    const wantDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "") ? params.date : null;
    const { data: latestRow } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1);
    const latestDate = latestRow?.[0]?.business_date ?? null;
    if (!latestDate) return respond(200, { anchor: null, fiscal: null, scopes: { regions: [], stores: [] }, values: emptyValues() });
    // Use the requested date only if we actually captured on/before it; otherwise
    // the latest we have (avoids an empty board on a bad date).
    let anchor = latestDate;
    if (wantDate && wantDate <= latestDate) {
      const { data: onDate } = await supa.from("labor_v2_daily").select("business_date").eq("business_date", wantDate).limit(1);
      if (onDate?.length) anchor = wantDate;
      else {
        const { data: before } = await supa.from("labor_v2_daily").select("business_date").lte("business_date", wantDate).order("business_date", { ascending: false }).limit(1);
        anchor = before?.[0]?.business_date ?? latestDate;
      }
    }

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
    for (const k of ["sales_vs_ly", "sales_dollars", "ly_dollars", "avg_ticket_time", "on_time", "splh", "tickets", "average_check", "labor_pct", "actual_vs_schedule", "overtime"]) {
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

    // Ranker-sourced metrics from the run covering the viewed week (newest run
    // whose week ends on/before the anchor). WTD run → Daily + WTD windows;
    // PTD run → MTD. EcoSure + Mystery Shop are PTD-only, so one value fills all.
    const rk = await rankerMetrics(supa, scopeStores, anchor);
    values.vog = {
      daily: pair(rk.vog.wtd, null), wtd: pair(rk.vog.wtd, null), mtd: pair(rk.vog.ptd, null),
      weeks: [null, null, null, null, null],
    };
    // L2R is the ranker's likely-to-return top-box — the same VOG figure, so the
    // Customer L2R headline shares that source.
    values.l2r = {
      daily: pair(rk.vog.wtd, null), wtd: pair(rk.vog.wtd, null), mtd: pair(rk.vog.ptd, null),
      weeks: [null, null, null, null, null],
    };
    values.ecosure_rank = {
      daily: pair(rk.ecosure, null), wtd: pair(rk.ecosure, null), mtd: pair(rk.ecosure, null),
      weeks: [null, null, null, null, null],
    };
    values.mystery_shop_rank = {
      daily: pair(rk.mysteryShop, null), wtd: pair(rk.mysteryShop, null), mtd: pair(rk.mysteryShop, null),
      weeks: [null, null, null, null, null],
    };

    // Targets: admin-set overrides (board_metric_targets) plus the data-driven
    // labor target from the feed (sales-weighted, never a fixed 26%). The
    // frontend uses these over the catalog defaults.
    const targets = await loadTargets(supa);
    if (laborAnchorD.labor_target != null) targets.labor_pct = round(laborAnchorD.labor_target);

    return respond(200, { anchor, fiscal: fi, scope: { level, id }, scopes, values, targets });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
}

// Admin-set target overrides, keyed by metric id. Best-effort: a missing table
// (migration not run) just yields no overrides.
async function loadTargets(supa) {
  try {
    const { data, error } = await supa.from("board_metric_targets").select("metric_id, target");
    if (error) return {};
    const out = {};
    for (const r of data || []) if (r.target != null) out[String(r.metric_id)] = Number(r.target);
    return out;
  } catch { return {}; }
}

function round(v) { return v == null || !isFinite(v) ? null : Math.round(v * 100) / 100; }
function pair(cur, prior) { return [round(cur), round(prior)]; }
function emptyValues() {
  const o = {};
  for (const id of METRIC_IDS) o[id] = { daily: [null, null], wtd: [null, null], mtd: [null, null], weeks: [null, null, null, null, null] };
  return o;
}
