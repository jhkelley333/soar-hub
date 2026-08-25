// Labor v2 — admin-only labor + sales by store, rolled up onto our org, with
// per-day history. Reads labor_v2_daily (populated by kpi-capture and by the
// refresh action here). Mirrors the KPI dashboard's org roll-up + drill-down.

import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveOrg } from "./_lib/kpiOrg.js";
import { fetchKpiFeed, kpiConfigured } from "./_lib/kpiFeed.js";
import { extractLaborRows, feedBusinessDate, feedSectionReport, wallClockInTz, isPre0238Error, stripRankingCols } from "./_lib/kpiLabor.js";
import { extractCountRows } from "./_lib/kpiCount.js";
import { upsertLaborCloses } from "./_lib/laborCloses.js";
import { fiscalForDate } from "./_lib/fiscal.js";
import { loadLaborCredits, applyCreditsToRows, loadTrainingCreditDates, loadGmPtoCreditDates, loadNoGmCreditDates, loadGmSupportCreditDates, loadCorporateTrainingCreditDates, corpTrainingDailyRate, CORP_TRAINING_DEFAULT_DAILY } from "./_lib/trainingCredit.js";
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
const READ_ROLES = new Set(["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]);
const REVIEW_ROLES = new Set(["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "admin"]);
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
// Labor v2 is the Sonic Expressway feed, so it's Sonic-only: exclude other
// brands (Apricus / Little Caesars, which are also `is_active` in the shared
// stores table). `brand is null` counts as Sonic — legacy rows predate the
// column (which defaults to 'sonic').
const SONIC_ONLY = "brand.eq.sonic,brand.is.null";
async function resolveVisibleStoreRows(supa, user) {
  if (roleOf(user) === "admin" || ORG_WIDE.has(roleOf(user))) {
    const { data } = await supa.from("stores").select("id, number, name, district_id, is_active").eq("is_active", true).or(SONIC_ONLY).order("number");
    return data ?? [];
  }
  const { data: visibleIds } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visibleIds ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa.from("stores").select("id, number, name, district_id, is_active").in("id", ids).eq("is_active", true).or(SONIC_ONLY).order("number");
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
    // Percentages carry 2 decimals so they match the raw KPI snapshot exactly
    // (e.g. 18.24%, not 18.2 shown as "18.20"). The $ / hours figures below are
    // computed from raw cost/sales, unaffected. status stays on the 1-decimal
    // miss threshold so over/under detection (and notes-due) is unchanged.
    labor_pct: laborPct == null ? null : round2(laborPct),
    // Each band carries its OWN target (daily / WTD / PTD differ) — the UI
    // must not reuse one band's goal for the others.
    goal_pct: goalPct == null ? null : round2(goalPct),
    sales: sales ?? null,
    variance_pts: laborPct != null && goalPct != null ? round2(laborPct - goalPct) : null,
    dollars_over_chart: dollarsOver,
    hours_over_chart: hoursOver,
    chart_dollars_allowed: chartAllowed,
    avg_wage: avgWage == null ? null : round2(avgWage),
    overtime_hours: row[`${prefix}overtime_hours`] != null ? round1(Number(row[`${prefix}overtime_hours`])) : null,
    training_credit: round2((row._tc?.[prefix === "" ? "day" : prefix === "wtd_" ? "wtd" : "ptd"]?.amt) ?? 0),
    labor_pct_pre: row._tcPre?.[prefix === "" ? "day" : prefix === "wtd_" ? "wtd" : "ptd"] != null
      ? round2(Number(row._tcPre[prefix === "" ? "day" : prefix === "wtd_" ? "wtd" : "ptd"]) * 100) : null,
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

// One store's dollars over chart for a band (cost − sales×target). Positive =
// over-spent; negative/zero = on or under. null when the store has no basis.
function storeDollarsOver(r, prefix) {
  const cost = numv(r[prefix + "labor_cost"]);
  const sales = numv(r[prefix + "net_sales"]);
  const target = numv(r[prefix + "target_labor_pct"]);
  if (!sales || !cost || !target) return null;
  return cost - sales * target;
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

// Ranker-aligned Hrs/Store for an AGGREGATE node's period-to-date band: the NET
// (signed — under-stores subtract) per-store hours over chart, averaged over
// ALL stores AND over the weeks elapsed in the period. This matches the Ranker's
// avgHoursOverPerStore (Σ per-store own-wage hours ÷ store count ÷ week), so the
// Labor region view and the Ranker show the same number. Only meaningful for the
// PTD band at district+; falls back to the plain per-store average when the week
// count is unknown (anchor outside the fiscal calendar).
// Hrs/Store for a period-to-date band, at any level (a single store or a
// district / area / region roll-up): sum ONLY the over-spending stores' hours
// over chart (under-stores are ignored, not netted), divided by ALL the node's
// stores and by the weeks elapsed in the period — one consistent per-store-per-
// week "how many hours of over-spend are we carrying" rate at every tier, so a
// region's number is the average of its stores' numbers.
function ptdHoursOverRankerAligned(rows, weeksInPeriod) {
  if (!rows.length || !weeksInPeriod) return hoursPerUnit(rows, "ptd_");
  const sumOver = rows.reduce((a, r) => { const h = storeHoursOver(r, "ptd_"); return a + (h != null && h > 0 ? h : 0); }, 0);
  return round2(sumOver / rows.length / weeksInPeriod);
}

// Override a PTD band's Hrs/Store with the per-store(-per-week) figure.
function withRankerHrs(band, rows, weeksInPeriod) {
  if (band) band.hours_over_chart = ptdHoursOverRankerAligned(rows, weeksInPeriod);
  return band;
}

// Company-wide Labor setting (generic store_portal_settings KV): whether PTD
// Hrs/Store is a per-week RATE (÷ weeks elapsed) or the raw PERIOD TOTAL per
// store. Defaults ON (÷ weeks) when unset.
const LABOR_HRS_WEEKLY_KEY = "labor_hrs_weekly_rate";
async function getLaborHrsWeekly(supa) {
  try {
    const { data } = await supa.from("store_portal_settings").select("value").eq("key", LABOR_HRS_WEEKLY_KEY).maybeSingle();
    return data?.value?.enabled !== false;
  } catch { return true; }
}
async function setLaborHrsWeekly(supa, enabled, userId) {
  return supa.from("store_portal_settings").upsert({
    key: LABOR_HRS_WEEKLY_KEY, value: { enabled: !!enabled },
    updated_by: userId ?? null, updated_at: new Date().toISOString(),
  });
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
// Compare the incoming rows against what's already stored for this business
// date; return field-level revisions (a previously-captured numeric value that
// changed). First captures (no existing row) and null->value backfills aren't
// revisions — only an actual value change counts.
const REVISION_EXCLUDE = new Set(["id", "store_number", "business_date", "captured_at", "created_at", "updated_at", "store_name"]);
async function computeRevisions(supa, table, source, newRows, businessDate) {
  const nums = [...new Set(newRows.map((r) => String(r.store_number)))];
  if (!nums.length) return [];
  const revs = [];
  // Per-store chunks keep the IN() query under the row cap at company scale.
  for (let i = 0; i < nums.length; i += 300) {
    const chunk = nums.slice(i, i + 300);
    const { data: existing } = await supa.from(table).select("*").eq("business_date", businessDate).in("store_number", chunk);
    const byStore = new Map((existing || []).map((r) => [String(r.store_number), r]));
    for (const nr of newRows) {
      const old = byStore.get(String(nr.store_number));
      if (!old) continue;
      for (const [k, v] of Object.entries(nr)) {
        if (REVISION_EXCLUDE.has(k) || typeof v !== "number" || !isFinite(v)) continue;
        const ov = old[k];
        if (ov == null || typeof Number(ov) !== "number" || !isFinite(Number(ov))) continue;
        if (Math.abs(v - Number(ov)) > 1e-6) {
          revs.push({ source, store_number: String(nr.store_number), business_date: businessDate, field: k, old_value: Number(ov), new_value: v });
        }
      }
    }
  }
  return revs;
}

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
    const revisions = [];
    if (rows.length) {
      // Detect restatements BEFORE the upsert overwrites the stored values.
      try { revisions.push(...await computeRevisions(supa, "labor_v2_daily", "labor", rows, businessDate)); }
      catch (e) { console.log(`[labor-v2] labor revision check failed: ${e.message}`); }
      let { error } = await supa.from("labor_v2_daily").upsert(rows, { onConflict: "store_number,business_date" });
      if (error && isPre0238Error(error)) {
        // Migration 0238 (ranking fields) not applied yet — land the old set.
        ({ error } = await supa.from("labor_v2_daily").upsert(stripRankingCols(rows), { onConflict: "store_number,business_date" }));
      }
      // Surface write failures instead of swallowing them — a missing column
      // (e.g. migration 0187 not applied) would otherwise leave stale rows with
      // no signal. The Postgres message names the offending column.
      if (error) throw new Error(`Couldn't save labor rows: ${error.message}`);
    }
    // Same feed carries the per-store daily count scores — fan them into
    // count_daily so a Labor v2 refresh also backfills the Daily Count page.
    try {
      const countRows = extractCountRows(payload).map((r) => ({
        ...r, business_date: businessDate, captured_at: new Date().toISOString(),
      }));
      if (countRows.length) {
        try { revisions.push(...await computeRevisions(supa, "count_daily", "count", countRows, businessDate)); }
        catch (e) { console.log(`[labor-v2] count revision check failed: ${e.message}`); }
        await supa.from("count_daily").upsert(countRows, { onConflict: "store_number,business_date" });
      }
    } catch (e) { console.log(`[labor-v2] count fan-out failed: ${e.message}`); }

    // Record any restatements (sheet already updated — latest wins — this is the
    // audit trail). Capped so a wholesale feed shift can't flood the table.
    if (revisions.length) {
      try {
        const stamped = revisions.slice(0, 5000).map((r) => ({ ...r, pull_source: source, detected_at: new Date().toISOString() }));
        await supa.from("labor_data_revisions").insert(stamped);
      } catch (e) { console.log(`[labor-v2] revision log failed: ${e.message}`); }
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

// Recent restatements (a re-pull changed an already-captured value). Admin.
async function dataRevisions(supa, params) {
  const bd = params?.business_date && /^\d{4}-\d{2}-\d{2}$/.test(params.business_date) ? params.business_date : null;
  let q = supa.from("labor_data_revisions").select("*").order("detected_at", { ascending: false }).limit(500);
  if (bd) q = q.eq("business_date", bd);
  const { data, error } = await q;
  if (error) {
    if (/labor_data_revisions/.test(error.message)) return { entries: [], note: "Run migration 0261 (labor_data_revisions table is missing)." };
    return { error: error.message, status: 500 };
  }
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
  applyCreditsToRows(rows || [], await loadLaborCredits(supa, numbers));
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

// The last business_date that actually captured labor within the fiscal week
// (Mon–Sun) ending on `weekEndIso`, for the given stores. The week picker keys
// past weeks by their week-ending Sunday, but captures often don't land on
// Sunday — so anchoring the rollup on the calendar Sunday shows "no data".
// This resolves to that week's last captured day (what the UI promises), and
// its WTD/PTD snapshot covers the week/period through that day.
async function weekLastCaptured(supa, numbers, weekEndIso) {
  const startIso = isoOf(shiftDays(new Date(`${weekEndIso}T00:00:00Z`), -6));
  const { data } = await supa.from("labor_v2_daily")
    .select("business_date")
    .in("store_number", numbers)
    .gte("business_date", startIso).lte("business_date", weekEndIso)
    .not("net_sales", "is", null)
    .order("business_date", { ascending: false }).limit(1).maybeSingle();
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

  // A past week is picked by its week-ending Sunday; anchor on that week's last
  // captured day (captures rarely land on the calendar Sunday). Otherwise a
  // specific day, else the latest captured day.
  const anchorIso = params.week
    ? ((await weekLastCaptured(supa, [storeNumber], params.week)) || params.week)
    : (params.date || (await latestBusinessDate(supa)));
  if (!anchorIso) return { store: storeRow, date: null, day: null, wtd: null, ptd: null, week: [], goal: null, notes_due: 0 };
  const anchor = parseIso(anchorIso);
  if (!anchor) return { error: "bad date", status: 400 };

  const week = weekDates(anchor);
  const [{ data: rows }, { data: reviews }] = await Promise.all([
    supa.from("labor_v2_daily").select("*").eq("store_number", storeNumber).gte("business_date", week[0]).lte("business_date", week[6]),
    supa.from("labor_reviews").select("*").eq("store_number", storeNumber).gte("business_date", week[0]).lte("business_date", week[6]),
  ]);
  applyCreditsToRows(rows ?? [], await loadLaborCredits(supa, [storeNumber]));
  const rowByDate = new Map((rows ?? []).map((r) => [r.business_date, r]));
  const reviewByDate = new Map((reviews ?? []).map((r) => [r.business_date, r]));

  const anchorRow = rowByDate.get(anchorIso) || null;
  // Footer/headline goal = PTD target if present, else the day's target.
  // Band cards use each band's own goal_pct from shapeBand, not this.
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
      review: review
        ? { note: review.note, by: review.reviewed_by_email, at: review.updated_at, root_cause: review.root_cause ?? null }
        : null,
    };
  };

  const weekStrip = week.map((iso) => {
    const r = rowByDate.get(iso);
    const laborPct = r ? pct(r.labor_pct) : null;
    const status = r ? chartStatus(laborPct, pct(r.target_labor_pct)) : "missing";
    // How many hours the day missed by — shown on each over day.
    const h = r && status === "over" ? storeHoursOver(r, "") : null;
    return {
      business_date: iso,
      labor_pct: laborPct == null ? null : round2(laborPct),
      status,
      note_due: status === "over" && !reviewByDate.get(iso),
      hours_over: h != null && h > 0 ? round1(h) : null,
    };
  });

  return {
    store: { number: storeRow.number, name: storeRow.name, district_id: storeRow.district_id },
    date: anchorIso,
    goal: goalPct == null ? null : round2(goalPct),
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
// Fixed root-cause list for a labor miss. "Other" still needs the note to
// tell the story; every option keeps the free-text explanation required.
const REVIEW_ROOT_CAUSES = new Set([
  "poor_projections",
  "scheduled_above_chart",
  "didnt_follow_schedule",
  "auto_clock",
  "other",
]);

async function saveReview(supa, user, body) {
  if (!REVIEW_ROLES.has(roleOf(user))) return { error: "You don't have permission to add a labor note.", status: 403 };
  const storeNumber = String(body?.store_number || "").trim();
  const businessDate = String(body?.business_date || "").trim();
  const note = String(body?.note ?? "").trim().slice(0, 2000);
  const rootCause = body?.root_cause ? String(body.root_cause).trim() : null;
  if (rootCause && !REVIEW_ROOT_CAUSES.has(rootCause)) {
    return { error: "root_cause must be one of the listed reasons.", status: 400 };
  }
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

  // Snapshot how many hours the day ran over chart (credit-adjusted, same
  // math the GM view displays) so the record carries the miss size.
  let hoursOver = null;
  try {
    const { data: dayRow } = await supa.from("labor_v2_daily")
      .select("*").eq("store_number", storeNumber).eq("business_date", businessDate).maybeSingle();
    if (dayRow) {
      applyCreditsToRows([dayRow], await loadLaborCredits(supa, [storeNumber]));
      const h = storeHoursOver(dayRow, "");
      if (h != null && h > 0) hoursOver = round1(h);
    }
  } catch { /* best-effort */ }

  const now = new Date().toISOString();
  const row = {
    store_id: storeRow.id, store_number: storeNumber, business_date: businessDate,
    reviewed_by_id: user.id, reviewed_by_email: user.email, note, acknowledged: true, updated_at: now,
    root_cause: rootCause, hours_over: hoursOver,
  };
  let { data, error } = await supa.from("labor_reviews").upsert(
    row, { onConflict: "store_id,business_date" },
  ).select("id, note, reviewed_by_email, updated_at").single();
  if (error && /root_cause|hours_over/.test(error.message)) {
    // Pre-0235: the columns don't exist yet.
    delete row.root_cause;
    delete row.hours_over;
    ({ data, error } = await supa.from("labor_reviews").upsert(row, { onConflict: "store_id,business_date" })
      .select("id, note, reviewed_by_email, updated_at").single());
  }
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
  // $ Over shows over-spend only: sum just the stores that ran over chart
  // (under-stores are ignored, not netted against). null when no store has a
  // basis, so a no-data node reads "—" rather than "$0".
  const overSum = rows.reduce((a, r) => { const d = storeDollarsOver(r, prefix); return a + (d != null && d > 0 ? d : 0); }, 0);
  const dollarsOver = sales ? round2(overSum) : null;
  const tcKey = prefix === "" ? "day" : prefix === "wtd_" ? "wtd" : "ptd";
  const trainingCredit = round2(rows.reduce((a, r) => a + numv(r._tc?.[tcKey]?.amt), 0));
  return {
    labor_pct: laborPct,
    target_pct: targetPct,
    variance_pts: laborPct != null && targetPct != null ? round1(laborPct - targetPct) : null,
    dollars_over_chart: dollarsOver,
    hours_over_chart: hoursPerUnit(rows, prefix),
    sales: sales ? round2(sales) : (sales === 0 ? 0 : null),
    scheduled_hours: s("scheduled_labor_hours"),
    actual_hours: hours,
    overtime_hours: s("overtime_hours"),
    act_vs_sched: s("actual_vs_scheduled_hours"),
    training_credit: trainingCredit,
    status: chartStatus(laborPct, targetPct),
  };
}

// Weekly Labor Miss Tracker export: for the chosen Mon-Sun week, each store
// whose total hours missed exceeds the threshold (default 7h), with hours
// missed by day and the filed explanation (root cause + note) by day.
async function missTracker(supa, user, params) {
  if (!READ_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const weekStart = params.week_start && /^\d{4}-\d{2}-\d{2}$/.test(params.week_start)
    ? parseIso(params.week_start) : null;
  if (!weekStart) return { error: "week_start (a Monday, YYYY-MM-DD) is required.", status: 400 };
  const threshold = Math.max(0, Number(params.threshold ?? 7)) || 0;

  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.length) return { week: [], threshold, rows: [] };
  const numbers = [...new Set(visible.map((st) => String(st.number)))];
  const nameByNumber = new Map(visible.map((st) => [String(st.number), st.name]));
  const orgMap = await resolveOrg(supa, numbers); // DO / SDO names per store

  const week = Array.from({ length: 7 }, (_, i) => isoOf(shiftDays(weekStart, i)));
  // Fetch one day at a time: a whole week across a big scope can exceed
  // PostgREST's 1000-row response cap, which silently truncates — the earliest
  // day (Monday) is what falls off. Per-day queries stay well under the cap.
  const perDay = await Promise.all(week.map((d) => Promise.all([
    supa.from("labor_v2_daily").select("*").eq("business_date", d).in("store_number", numbers),
    supa.from("labor_reviews").select("store_number, business_date, note, root_cause")
      .eq("business_date", d).in("store_number", numbers),
  ])));
  const rows = perDay.flatMap(([r]) => r.data || []);
  const reviews = perDay.flatMap(([, r]) => r.data || []);
  applyCreditsToRows(rows, await loadLaborCredits(supa, numbers));

  const CAUSE_LABEL = {
    poor_projections: "Poor Projections",
    scheduled_above_chart: "Scheduled Above Chart",
    didnt_follow_schedule: "Didn't Follow the Schedule",
    auto_clock: "Auto Clock",
    other: "Other",
  };
  const reviewKey = (sn, d) => `${sn}|${d}`;
  const reviewMap = new Map(reviews.map((r) => [reviewKey(String(r.store_number), r.business_date), r]));

  const byStore = new Map();
  for (const r of rows) {
    const sn = String(r.store_number);
    const laborPct = pct(r.labor_pct);
    if (chartStatus(laborPct, pct(r.target_labor_pct)) !== "over") continue;
    const h = storeHoursOver(r, "");
    if (h == null || h <= 0) continue;
    if (!byStore.has(sn)) {
      const org = orgMap.get(sn);
      byStore.set(sn, {
        store_number: sn,
        store_name: nameByNumber.get(sn) ?? null,
        do_name: org?.doName ?? null,
        sdo_name: org?.sdoName ?? null,
        total: 0, days: {}, explanations: {},
      });
    }
    const row = byStore.get(sn);
    row.days[r.business_date] = round1(h);
    row.total = round1(row.total + h);
    const rev = reviewMap.get(reviewKey(sn, r.business_date));
    if (rev) {
      const cause = rev.root_cause ? CAUSE_LABEL[rev.root_cause] ?? rev.root_cause : "";
      row.explanations[r.business_date] = [cause, rev.note].filter(Boolean).join(" \u2014 ");
    }
  }
  const out = [...byStore.values()]
    .filter((r) => r.total > threshold)
    .sort((a, b) => b.total - a.total);
  return { week, threshold, rows: out };
}

// ── Per-RVP labor scorecard ──────────────────────────────────────────
// Each region's WTD Hours Over Chart, credit-adjusted, averaged over the last
// N completed fiscal weeks (default 4). "Hours over chart per store" is the
// same Hrs/Unit metric the region cards show (positive store overages ÷ every
// store); "region total" sums the positive store overages. Compares every RVP
// in the caller's scope — a cross-region leadership view (VP / COO / admin see
// all five; an RVP sees only their own region).
const SCORECARD_ROLES = new Set(["rvp", "vp", "coo", "admin"]);
async function rvpScorecard(supa, user, params) {
  if (!SCORECARD_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const weeksBack = Math.min(Math.max(Math.round(Number(params.weeks) || 4), 1), 12);

  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.length) return { anchor: null, weeks: [], rvps: [] };
  const numbers = [...new Set(visible.map((s) => String(s.number)))];

  const { data: latest } = await supa.from("labor_v2_daily")
    .select("business_date").order("business_date", { ascending: false }).limit(1);
  const anchor = latest?.[0]?.business_date ?? null;
  if (!anchor) return { anchor: null, weeks: [], rvps: [] };

  // Anchor the series to the most recent CLOSED fiscal week, then walk back in
  // 7-day steps (fiscal weeks are contiguous 7-day blocks, so this stays aligned).
  const aw = fiscalForDate(anchor);
  const endIso = aw
    ? (aw.weekEnd <= anchor ? aw.weekEnd : isoOf(shiftDays(parseIso(aw.weekStart), -1)))
    : anchor;
  const weekEnds = Array.from({ length: weeksBack }, (_, i) => isoOf(shiftDays(parseIso(endIso), -7 * i)));

  const orgMap = await resolveOrg(supa, numbers);
  const credits = await loadLaborCredits(supa, numbers);

  // Each week's closing (Sunday) rows carry that week's full WTD; credit-adjust,
  // then aggregate by region exactly as the team rollup does.
  const perWeek = await Promise.all(weekEnds.map((weekEnd) =>
    supa.from("labor_v2_daily").select("*").eq("business_date", weekEnd).in("store_number", numbers)
      .then(({ data }) => {
        const rows = data || [];
        applyCreditsToRows(rows, credits);
        return { weekEnd, rows };
      })));

  const regions = new Map(); // region name -> { region, rvpName, weekly: Map }
  for (const { weekEnd, rows } of perWeek) {
    const byRegion = new Map();
    for (const r of rows) {
      const org = orgMap.get(String(r.store_number));
      const region = org?.region || "Unassigned";
      if (!byRegion.has(region)) byRegion.set(region, { rvpName: org?.rvpName ?? null, rows: [] });
      byRegion.get(region).rows.push(r);
    }
    for (const [region, grp] of byRegion) {
      if (!regions.has(region)) regions.set(region, { region, rvpName: grp.rvpName, weekly: new Map() });
      const reg = regions.get(region);
      if (grp.rvpName && !reg.rvpName) reg.rvpName = grp.rvpName;
      const perStore = hoursPerUnit(grp.rows, "wtd_");
      const total = round2(grp.rows.reduce((a, r) => { const h = storeHoursOver(r, "wtd_"); return a + (h && h > 0 ? h : 0); }, 0));
      reg.weekly.set(weekEnd, { perStore, total, stores: grp.rows.length });
    }
  }

  const avg = (a) => (a.length ? round2(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const rvps = [...regions.values()].map((reg) => {
    const weekly = weekEnds.map((wk) => ({ weekEnd: wk, ...(reg.weekly.get(wk) || { perStore: null, total: null, stores: 0 }) }));
    const perStoreVals = weekly.map((w) => w.perStore).filter((v) => v != null);
    const totalVals = weekly.map((w) => w.total).filter((v) => v != null);
    return {
      region: reg.region,
      rvp_name: reg.rvpName,
      stores: weekly.reduce((m, w) => Math.max(m, w.stores), 0),
      weeks_with_data: perStoreVals.length,
      avg_hours_over_per_store: avg(perStoreVals),
      avg_hours_over_total: avg(totalVals),
      weekly,
    };
  }).sort((a, b) => (b.avg_hours_over_per_store ?? -Infinity) - (a.avg_hours_over_per_store ?? -Infinity));

  return { anchor, weeks: weekEnds, rvps };
}

// ── RVP Commitments ──────────────────────────────────────────────────
// Per-region target vs. live actual for three metrics. Labor metrics come from
// the labor engine (current fiscal week WTD); COGS Efficiency comes from the
// most recent IX food-cost upload (weekly, per-RVP rows). Targets live in
// rvp_commitments and are edited by the region's RVP or VP/COO/admin.
const COMMIT_ROLES = new Set(["rvp", "vp", "coo", "admin"]);
const COMMIT_METRICS = new Set(["labor_hours_over", "labor_avs_pct", "cogs_efficiency"]);

// Per-RVP COGS efficiency from the ranking board — the same numbers the Ranker
// shows. Reads the latest complete run's rvp-tier rows (metrics.cogsEff, a
// fraction) keyed by RVP name (entity_key == resolveOrg rvpName), plus a
// baseline = average across the last `weeksBack` complete runs (PTD).
// baseWeekEnds (optional): when provided, the baseline averages one complete run
// per those specific weeks (the pinned 4-week base). When null, it falls back to
// the sliding last-`weeksBack` complete runs. `latest` is always the newest run.
async function cogsByRvpFromRuns(supa, weeksBack = 4, baseWeekEnds = null) {
  const empty = { latest: new Map(), baseline: new Map(), weekInPeriod: 1 };
  const { data: latestRuns } = await supa.from("ranking_runs")
    .select("id, week_ending, week").eq("status", "complete")
    .order("started_at", { ascending: false }).limit(1);
  if (!latestRuns?.length) return empty;
  const latestRunId = latestRuns[0].id;
  const weekInPeriod = Math.max(1, Number(latestRuns[0].week) || 1);

  // Base runs: one complete run per pinned week (latest per week), or the last N.
  let baseRuns;
  if (baseWeekEnds && baseWeekEnds.length) {
    const { data } = await supa.from("ranking_runs")
      .select("id, week_ending, week").eq("status", "complete")
      .in("week_ending", baseWeekEnds).order("started_at", { ascending: false });
    const seen = new Set();
    baseRuns = [];
    for (const r of data || []) { if (!seen.has(r.week_ending)) { seen.add(r.week_ending); baseRuns.push(r); } }
  } else {
    const { data } = await supa.from("ranking_runs")
      .select("id, week_ending, week").eq("status", "complete")
      .order("started_at", { ascending: false }).limit(weeksBack);
    baseRuns = data || [];
  }
  const baseRunIds = new Set(baseRuns.map((r) => r.id));
  const runIds = [...new Set([latestRunId, ...baseRuns.map((r) => r.id)])];
  const weekByRun = new Map([[latestRunId, latestRuns[0].week_ending], ...baseRuns.map((r) => [r.id, r.week_ending])]);
  const { data: rows } = await supa.from("ranking_rows")
    .select("run_id, entity_key, metrics")
    .in("run_id", runIds).eq("scope", "ptd").eq("tier", "rvp");
  const latest = new Map();
  const acc = new Map();
  const num = (v) => (isFinite(Number(v)) ? Math.round(Number(v)) : null);
  for (const r of rows || []) {
    const name = String(r.entity_key);
    const m = r.metrics || {};
    const eff = Number(m.cogsEff);
    if (isFinite(eff) && baseRunIds.has(r.run_id)) (acc.get(name) || acc.set(name, []).get(name)).push(round2(eff * 100));
    if (r.run_id === latestRunId) {
      // Labor $ over chart + food-cost $ over the 96% target + combined. The
      // Ranker's *Miss fields are period-to-date; the *Annualized fields are the
      // true annual rate. Derive weekly from annual (/52) so weekly and 30-day
      // aren't inflated by however many weeks into the period we are.
      const la = num(m.laborAnnualized), fa = num(m.fcAnnualized), na = num(m.finAnnualized);
      const wk = (annual) => (annual == null ? null : Math.round(annual / 52));
      latest.set(name, {
        cogs_pct: isFinite(eff) ? round2(eff * 100) : null,
        week: weekByRun.get(r.run_id),
        dollars: {
          labor_weekly: wk(la), labor_annual: la,
          cogs_weekly: wk(fa), cogs_annual: fa,
          total_weekly: wk(na), total_annual: na,
        },
      });
    }
  }
  const baseline = new Map();
  for (const [name, arr] of acc) baseline.set(name, round2(arr.reduce((a, b) => a + b, 0) / arr.length));
  return { latest, baseline, weekInPeriod };
}

// Per-RVP actual food-cost dollars (period-to-date) from the latest IX upload,
// so COGS savings can be computed for ANY target — including one above the
// Ranker's 96% standard (where fcMiss is 0 and can't scale). Reconstructs actual
// cost from fc_variance + efficiency when the dollar columns are blank:
// eff = ideal/actual and variance = ideal - actual  =>  actual = -variance/(1-eff).
// Returns Map(rvpName -> actualPeriodFoodCost$).
async function ixCogsActualByRvp(supa) {
  const out = new Map();
  const { data: files } = await supa.from("ranking_source_files")
    .select("id, uploaded_at").eq("source", "ix").eq("status", "parsed")
    .order("uploaded_at", { ascending: false }).limit(24);
  if (!files?.length) return out;
  // Prefer a period-to-date file (matches the PTD annualization); else newest.
  let pick = files[0];
  for (const f of files) {
    const { data: probe } = await supa.from("ranking_src_rows").select("payload").eq("file_id", f.id).limit(1);
    if (probe?.[0]?.payload?.scope !== "wtd") { pick = f; break; }
  }
  const { data: rows } = await supa.from("ranking_src_rows").select("payload").eq("file_id", pick.id).limit(2500);
  for (const { payload: p } of rows || []) {
    if (p?.level !== "rvp" || !p.leader) continue;
    let actual = Number(p.actual_dollars);
    if (!(actual > 0)) {
      const eff = Number(p.cogs_eff), variance = Number(p.fc_variance);
      if (isFinite(eff) && eff > 0 && eff < 1 && isFinite(variance)) actual = -variance / (1 - eff);
    }
    if (actual > 0) out.set(String(p.leader), actual);
  }
  return out;
}

// Per-region labor values for a list of fiscal week-ending dates. Returns
// Map(region -> Map(weekEnd -> { hours_over, avs_pct })). Hours Over Chart is
// credit-adjusted; AvS % is raw actual/scheduled. Future/empty weeks are simply
// absent (the caller treats missing as null placeholder).
async function laborWeeklyByRegion(supa, numbers, orgMap, weekEnds, credits) {
  const out = new Map();
  for (const weekEnd of weekEnds) {
    const { data } = await supa.from("labor_v2_daily").select("*").eq("business_date", weekEnd).in("store_number", numbers);
    const rows = data || [];
    const rawByRegion = new Map();
    for (const r of rows) {
      const region = orgMap.get(String(r.store_number))?.region || "Unassigned";
      const a = rawByRegion.get(region) || { actual: 0, sched: 0 };
      a.actual += numv(r.wtd_labor_hours); a.sched += numv(r.wtd_scheduled_labor_hours);
      rawByRegion.set(region, a);
    }
    applyCreditsToRows(rows, credits);
    const byRegion = new Map();
    for (const r of rows) {
      const region = orgMap.get(String(r.store_number))?.region || "Unassigned";
      (byRegion.get(region) || byRegion.set(region, []).get(region)).push(r);
    }
    for (const region of new Set([...rawByRegion.keys(), ...byRegion.keys()])) {
      const a = rawByRegion.get(region);
      const rrows = byRegion.get(region) || [];
      const wk = {
        hours_over: rrows.length ? hoursPerUnit(rrows, "wtd_") : null,
        avs_pct: a && a.sched ? round2((a.actual / a.sched) * 100) : null,
      };
      (out.get(region) || out.set(region, new Map()).get(region)).set(weekEnd, wk);
    }
  }
  return out;
}

// Per-RVP COGS efficiency % for a list of week-ending dates, from each week's
// latest complete ranking run. Returns Map(rvpName -> Map(weekEnd -> cogs_pct)).
async function cogsWeeklyByRvp(supa, weekEnds) {
  const out = new Map();
  if (!weekEnds.length) return out;
  const { data: runs } = await supa.from("ranking_runs")
    .select("id, week_ending, started_at").eq("status", "complete")
    .in("week_ending", weekEnds).order("started_at", { ascending: false });
  const runByWeek = new Map();
  for (const r of runs || []) if (!runByWeek.has(r.week_ending)) runByWeek.set(r.week_ending, r.id);
  const runIds = [...runByWeek.values()];
  if (!runIds.length) return out;
  const weekByRun = new Map([...runByWeek.entries()].map(([w, id]) => [id, w]));
  const { data: rows } = await supa.from("ranking_rows")
    .select("run_id, entity_key, metrics").in("run_id", runIds).eq("scope", "ptd").eq("tier", "rvp");
  for (const r of rows || []) {
    const eff = Number(r.metrics?.cogsEff);
    if (!isFinite(eff)) continue;
    const name = String(r.entity_key);
    (out.get(name) || out.set(name, new Map()).get(name)).set(weekByRun.get(r.run_id), round2(eff * 100));
  }
  return out;
}

// The shared 30-day tracking window (4 fiscal weeks). Stored in ea_settings so
// it stays fixed once set; computed + persisted the first time from today's
// fiscal week (the next 4 full weeks).
async function trackingWindow(supa) {
  const { data: row } = await supa.from("ea_settings").select("value").eq("key", "rvp_commitment_window").maybeSingle();
  const stored = Array.isArray(row?.value?.week_ends) ? row.value.week_ends : null;
  if (stored && stored.length) return stored;
  const wc = wallClockInTz(new Date(), TZ);
  const todayIso = `${wc.year}-${String(wc.month).padStart(2, "0")}-${String(wc.day).padStart(2, "0")}`;
  const fi = fiscalForDate(todayIso);
  if (!fi) return [];
  const weekEnds = Array.from({ length: 4 }, (_, i) => isoOf(shiftDays(parseIso(fi.weekEnd), 7 * (i + 1))));
  await supa.from("ea_settings").upsert({ key: "rvp_commitment_window", value: { week_ends: weekEnds } }, { onConflict: "key" });
  return weekEnds;
}

// The 4-week base anchor. By default the base slides with the latest data; once
// pinned (stored in ea_settings) it stays fixed on a reference week so the
// committed baseline doesn't move week to week. The stored value is the
// REFERENCE week-ending Sunday; the base is the 4 completed weeks STRICTLY
// BEFORE it (e.g. anchor 2026-08-02 -> base weeks ending 07-26/07-19/07-12/07-05).
async function baseAnchor(supa) {
  const { data: row } = await supa.from("ea_settings").select("value").eq("key", "rvp_commitment_base_anchor").maybeSingle();
  const we = row?.value?.week_end;
  return (typeof we === "string" && /^\d{4}-\d{2}-\d{2}$/.test(we)) ? we : null;
}

// The 4 week-ending Sundays that make up the base for a given reference week
// (strictly before it), or the sliding last-4 when no reference is pinned.
function baseWeekEndsFor(anchorRef, latestAnchor, fi) {
  if (anchorRef) return Array.from({ length: 4 }, (_, i) => isoOf(shiftDays(parseIso(anchorRef), -7 * (i + 1))));
  if (!latestAnchor) return [];
  const baseEnd = fi ? (fi.weekEnd <= latestAnchor ? fi.weekEnd : isoOf(shiftDays(parseIso(fi.weekStart), -1))) : latestAnchor;
  return Array.from({ length: 4 }, (_, i) => isoOf(shiftDays(parseIso(baseEnd), -7 * i)));
}

// Bucket visibility: a global default plus per-region overrides. A region uses
// its own list if it has one, else the global default. Stored in one setting.
async function bucketSettings(supa) {
  const { data: row } = await supa.from("ea_settings").select("value").eq("key", "rvp_commitment_hidden_metrics").maybeSingle();
  const v = row?.value || {};
  const clean = (a) => (Array.isArray(a) ? a.filter((m) => COMMIT_METRICS.has(m)) : []);
  const byRegion = {};
  if (v.byRegion && typeof v.byRegion === "object") {
    for (const [rg, arr] of Object.entries(v.byRegion)) byRegion[rg] = clean(arr);
  }
  return { global: clean(v.hidden), byRegion };
}
const effectiveHidden = (buckets, region) =>
  Object.prototype.hasOwnProperty.call(buckets.byRegion, region) ? buckets.byRegion[region] : buckets.global;

// The $ the COMMITMENT is worth — moving each metric from its 4-week BASE to the
// TARGET (a fixed value tied to the pinned base, not the shrinking live gap),
// counting only the buckets this RVP is tracking. Worked in ANNUAL terms (the
// Ranker's *Annualized fields are the reliable rate); weekly = annual/52. Labor $
// derives from the Hours Over Chart bucket (AvS is a discipline lever, no separate
// $, to avoid double-counting). COGS $ = annualized food cost x (1 - effBase/effTarget)
// — works for any target, above or below the 96% standard.
// Dollarize the improvement from `fromV` to `toV` per metric (positive only when
// `toV` is BETTER than `fromV` — fewer hours over, higher COGS efficiency). The
// rate is anchored to the live ACTUAL (dollars.* are the $ at the actual), so
// this works for base->target (committed savings), base->actual (realized), and
// actual->target (cost of the gap / miss). Annual terms; weekly = annual/52.
function metricGapDollars(fromV, toV, { tracked, actuals, dollars, ixActualFood, weekInPeriod }) {
  let laborAnnual = 0;
  if (tracked.has("labor_hours_over")) {
    const F = fromV.labor_hours_over, T = toV.labor_hours_over, A = actuals.labor_hours_over;
    if (F != null && T != null && F > T && A != null && A > 0 && dollars.labor_annual != null) {
      laborAnnual = dollars.labor_annual * ((F - T) / A);
    }
  }
  let cogsAnnual = 0;
  if (tracked.has("cogs_efficiency")) {
    const F = fromV.cogs_efficiency, T = toV.cogs_efficiency, A = actuals.cogs_efficiency; // percents
    if (F != null && T != null && T > F) {
      const effF = F / 100, effT = T / 100, effA = A != null ? A / 100 : null;
      let annualFood = ixActualFood > 0 ? ixActualFood * (52 / Math.max(1, weekInPeriod)) : 0;
      // Fallback (below the 96% standard only): back out the food base from the
      // Ranker's annualized fc-miss = annualFood x (1 - effActual/0.96).
      if (!(annualFood > 0) && dollars.cogs_annual > 0 && effA != null && effA < 0.96) {
        annualFood = dollars.cogs_annual / (1 - effA / 0.96);
      }
      if (annualFood > 0) cogsAnnual = Math.max(0, annualFood * (1 - effF / effT));
    }
  }
  const r = (v) => (isFinite(v) ? Math.round(v) : null);
  return {
    labor_weekly: r(laborAnnual / 52), labor_annual: r(laborAnnual),
    cogs_weekly: r(cogsAnnual / 52), cogs_annual: r(cogsAnnual),
    total_weekly: r((laborAnnual + cogsAnnual) / 52), total_annual: r(laborAnnual + cogsAnnual),
  };
}

// The $ the COMMITMENT is worth — moving each metric from its 4-week BASE to the
// TARGET, tracked buckets only.
function targetDollars({ baselines, targets, ...rest }) {
  return metricGapDollars(baselines, targets, rest);
}

// The caller's in-scope region names, from their visible stores' org.
async function callerRegions(supa, user) {
  const visible = await resolveVisibleStoreRows(supa, user);
  const numbers = [...new Set(visible.map((s) => String(s.number)))];
  const orgMap = await resolveOrg(supa, numbers);
  const regions = new Set(numbers.map((n) => orgMap.get(n)?.region).filter(Boolean));
  return { numbers, orgMap, regions };
}

async function rvpCommitments(supa, user) {
  if (!COMMIT_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const { numbers, orgMap, regions } = await callerRegions(supa, user);
  if (!regions.size) return { anchor: null, week: null, rows: [] };

  const { data: latest } = await supa.from("labor_v2_daily")
    .select("business_date").order("business_date", { ascending: false }).limit(1);
  const anchor = latest?.[0]?.business_date ?? null;
  const fi = anchor ? fiscalForDate(anchor) : null;

  let rows = [];
  if (anchor) {
    const { data } = await supa.from("labor_v2_daily").select("*").eq("business_date", anchor).in("store_number", numbers);
    rows = data || [];
  }
  // AvS% is scheduling adherence — compute from RAW WTD hours BEFORE credits.
  const rawByRegion = new Map();
  for (const r of rows) {
    const region = orgMap.get(String(r.store_number))?.region || "Unassigned";
    const a = rawByRegion.get(region) || { actual: 0, sched: 0 };
    a.actual += numv(r.wtd_labor_hours);
    a.sched += numv(r.wtd_scheduled_labor_hours);
    rawByRegion.set(region, a);
  }
  // Hours Over Chart is credit-adjusted, same as everywhere else.
  applyCreditsToRows(rows, await loadLaborCredits(supa, numbers));
  const rowsByRegion = new Map();
  for (const r of rows) {
    const region = orgMap.get(String(r.store_number))?.region || "Unassigned";
    (rowsByRegion.get(region) || rowsByRegion.set(region, []).get(region)).push(r);
  }

  // Baseline = 4 completed fiscal weeks. It slides with the latest data unless
  // an RVP-commitment base anchor is pinned, in which case it's the 4 weeks
  // strictly before that reference week and stays fixed. Tracking = 30-day window.
  const anchorRef = await baseAnchor(supa);
  const baseWeekEnds = baseWeekEndsFor(anchorRef, anchor, fi);
  // The Actual shown is the average of the last 4 COMPLETED weeks (a sustained,
  // trailing figure — "how they're impacting the long run"), always trailing the
  // latest data regardless of whether the base is pinned.
  const recentWeekEnds = baseWeekEndsFor(null, anchor, fi);
  const trackWeekEnds = await trackingWindow(supa);
  const allWeekEnds = [...new Set([...baseWeekEnds, ...recentWeekEnds, ...trackWeekEnds])];

  const credits = await loadLaborCredits(supa, numbers);
  const [cogs, laborWk, cogsWk, buckets, ixActualFood] = await Promise.all([
    cogsByRvpFromRuns(supa, 4, anchorRef ? baseWeekEnds : null),
    laborWeeklyByRegion(supa, numbers, orgMap, allWeekEnds, credits),
    cogsWeeklyByRvp(supa, [...new Set([...trackWeekEnds, ...recentWeekEnds])]),
    bucketSettings(supa),
    ixCogsActualByRvp(supa),
  ]);
  const weekInPeriod = cogs.weekInPeriod ?? 1;
  const { data: commits } = await supa.from("rvp_commitments").select("*");
  const targetOf = (region, metric) => {
    const c = (commits || []).find((x) => x.region === region && x.metric === metric);
    return c ? Number(c.target_value) : null;
  };
  const rvpForRegion = (region) => {
    for (const n of numbers) { const o = orgMap.get(n); if (o?.region === region && o.rvpName) return o.rvpName; }
    return null;
  };
  // Store count from the org (stable), not just this week's rows.
  const storeCount = new Map();
  for (const n of numbers) { const rg = orgMap.get(n)?.region; if (rg) storeCount.set(rg, (storeCount.get(rg) || 0) + 1); }
  const avg = (arr) => (arr.length ? round2(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const baseAvg = (region, field) =>
    avg(baseWeekEnds.map((we) => laborWk.get(region)?.get(we)?.[field]).filter((v) => v != null));
  const recentAvg = (region, field) =>
    avg(recentWeekEnds.map((we) => laborWk.get(region)?.get(we)?.[field]).filter((v) => v != null));
  const cogsRecentAvg = (rvpName) =>
    avg(recentWeekEnds.map((we) => (rvpName ? cogsWk.get(String(rvpName))?.get(we) : null)).filter((v) => v != null));

  // Only real RVP regions: has an assigned RVP and at least one store.
  const out = [...regions]
    .filter((r) => r && r !== "Unassigned" && rvpForRegion(r) && (storeCount.get(r) || 0) > 0)
    .map((region) => {
    const rrows = rowsByRegion.get(region) || [];
    const raw = rawByRegion.get(region) || { actual: 0, sched: 0 };
    const rvpName = rvpForRegion(region);
    const cogsLatest = rvpName ? cogs.latest.get(String(rvpName)) : null;
    const laborSeries = (field) => trackWeekEnds.map((we) => ({ weekEnd: we, value: laborWk.get(region)?.get(we)?.[field] ?? null }));
    const cogsSeries = () => trackWeekEnds.map((we) => ({ weekEnd: we, value: (rvpName ? cogsWk.get(String(rvpName))?.get(we) : null) ?? null }));
    // The trailing weeks that make up the 4-week actual, oldest -> newest, so the
    // download can show week-to-week performance.
    const recentAsc = [...recentWeekEnds].sort();
    const laborRecent = (field) => recentAsc.map((we) => ({ weekEnd: we, value: laborWk.get(region)?.get(we)?.[field] ?? null }));
    const cogsRecent = () => recentAsc.map((we) => ({ weekEnd: we, value: (rvpName ? cogsWk.get(String(rvpName))?.get(we) : null) ?? null }));
    const hidden = effectiveHidden(buckets, region);
    const tracked = new Set([...COMMIT_METRICS].filter((m) => !hidden.includes(m)));
    const actuals = {
      labor_hours_over: hoursPerUnit(rrows, "wtd_"),
      labor_avs_pct: raw.sched ? round2((raw.actual / raw.sched) * 100) : null,
      cogs_efficiency: cogsLatest?.cogs_pct ?? null,
    };
    const targets = {
      labor_hours_over: targetOf(region, "labor_hours_over"),
      labor_avs_pct: targetOf(region, "labor_avs_pct"),
      cogs_efficiency: targetOf(region, "cogs_efficiency"),
    };
    const dollars = cogsLatest?.dollars ?? { labor_weekly: null, labor_annual: null, cogs_weekly: null, cogs_annual: null, total_weekly: null, total_annual: null };
    const baselines = {
      labor_hours_over: baseAvg(region, "hours_over"),
      labor_avs_pct: baseAvg(region, "avs_pct"),
      cogs_efficiency: rvpName ? (cogs.baseline.get(String(rvpName)) ?? null) : null,
    };
    // Actual = average of the last 4 completed weeks (falls back to the live
    // current-week figure when a metric has no weekly history yet).
    const actual4wk = {
      labor_hours_over: recentAvg(region, "hours_over") ?? actuals.labor_hours_over,
      labor_avs_pct: recentAvg(region, "avs_pct") ?? actuals.labor_avs_pct,
      cogs_efficiency: cogsRecentAvg(rvpName) ?? actuals.cogs_efficiency,
    };
    const regionFood = rvpName ? (ixActualFood.get(String(rvpName)) ?? 0) : 0;
    const dollarArgs = { tracked, actuals, dollars, ixActualFood: regionFood, weekInPeriod };
    return {
      region, rvp_name: rvpName, stores: storeCount.get(region) ?? rrows.length,
      hidden_metrics: hidden,
      actuals,
      actual4wk,
      baselines,
      weekly: {
        labor_hours_over: laborSeries("hours_over"),
        labor_avs_pct: laborSeries("avs_pct"),
        cogs_efficiency: cogsSeries(),
      },
      // Trailing per-week values (last 4 completed weeks) for the download's
      // week-to-week view.
      recent: {
        labor_hours_over: laborRecent("hours_over"),
        labor_avs_pct: laborRecent("avs_pct"),
        cogs_efficiency: cogsRecent(),
      },
      // Full opportunity to standard (labor over chart + food cost over target).
      dollars,
      // The committed value — moving each metric from its 4-week base to the
      // target, tracked buckets only.
      target_dollars: metricGapDollars(baselines, targets, dollarArgs),
      // Realized so far: base -> current 4-wk actual (savings already achieved).
      saved_dollars: metricGapDollars(baselines, actual4wk, dollarArgs),
      // Cost of the gap to target: current 4-wk actual -> target (>0 only when
      // off track). "How much the miss is costing."
      miss_dollars: metricGapDollars(actual4wk, targets, dollarArgs),
      cogs_week: cogsLatest?.week ?? null,
      targets,
    };
  }).sort((a, b) => (a.rvp_name ?? a.region).localeCompare(b.rvp_name ?? b.region));

  const sumOf = (key, field) => { const vals = out.map((r) => r[key]?.[field]).filter((v) => v != null); return vals.length ? vals.reduce((a, b) => a + b, 0) : null; };
  const sum = (field) => sumOf("target_dollars", field);
  const totals = {
    labor_weekly: sum("labor_weekly"), labor_annual: sum("labor_annual"),
    cogs_weekly: sum("cogs_weekly"), cogs_annual: sum("cogs_annual"),
    total_weekly: sum("total_weekly"), total_annual: sum("total_annual"),
  };
  const saved_totals = {
    total_weekly: sumOf("saved_dollars", "total_weekly"), total_annual: sumOf("saved_dollars", "total_annual"),
  };
  const miss_totals = {
    total_weekly: sumOf("miss_dollars", "total_weekly"), total_annual: sumOf("miss_dollars", "total_annual"),
  };

  // Picker options: recent week-ending Sundays (as reference weeks). The most
  // recent completed Sunday on/before the anchor, going back 16 weeks.
  const lastSun = fi ? (fi.weekEnd <= anchor ? fi.weekEnd : isoOf(shiftDays(parseIso(fi.weekStart), -1))) : anchor;
  const baseOptions = lastSun ? Array.from({ length: 16 }, (_, i) => isoOf(shiftDays(parseIso(lastSun), -7 * i))) : [];

  return {
    anchor,
    week: fi ? { start: fi.weekStart, end: fi.weekEnd } : null,
    tracking: { week_ends: trackWeekEnds, end: trackWeekEnds[trackWeekEnds.length - 1] ?? null },
    // 4-week base state: `anchor_week_end` null = sliding; set = pinned to the 4
    // weeks strictly before that reference week. `week_ends` are those 4 weeks.
    base: { anchor_week_end: anchorRef, week_ends: baseWeekEnds, options: baseOptions },
    recent_week_ends: recentWeekEnds,
    hidden_metrics: buckets.global,
    totals,
    saved_totals,
    miss_totals,
    rows: out,
  };
}

// Set which metric buckets are hidden. With `region`, sets that RVP's override;
// without, sets the global default. VP/COO/admin only.
async function rvpCommitmentBucketsSet(supa, user, body) {
  if (!new Set(["vp", "coo", "admin"]).has(roleOf(user))) return { error: "VP and above only.", status: 403 };
  const hidden = Array.isArray(body?.hidden) ? [...new Set(body.hidden.filter((m) => COMMIT_METRICS.has(m)))] : [];
  const region = body?.region ? String(body.region).trim() : null;
  const buckets = await bucketSettings(supa);
  const value = { hidden: buckets.global, byRegion: { ...buckets.byRegion } };
  if (region) {
    // Scope check: caller must see the region.
    const { regions } = await callerRegions(supa, user);
    if (!regions.has(region)) return { error: `Region ${region} is outside your scope.`, status: 403 };
    value.byRegion[region] = hidden;
  } else {
    value.hidden = hidden;
  }
  const { error } = await supa.from("ea_settings").upsert(
    { key: "rvp_commitment_hidden_metrics", value, updated_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true, hidden, region };
}

// Pin (or clear) the 4-week base anchor. Pass a fiscal week-ending Sunday to pin
// the base to the 4 weeks strictly before it; pass empty/null to clear (base
// slides again). Global setting — VP/COO/admin only, same as buckets/tracking.
async function rvpCommitmentBaseSet(supa, user, body) {
  if (!new Set(["vp", "coo", "admin"]).has(roleOf(user))) return { error: "VP and above only.", status: 403 };
  const raw = String(body?.week_end ?? "").trim();
  if (!raw) {
    const { error } = await supa.from("ea_settings").delete().eq("key", "rvp_commitment_base_anchor");
    if (error) return { error: error.message, status: 500 };
    return { ok: true, anchor_week_end: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "week_end must be YYYY-MM-DD.", status: 400 };
  const fx = fiscalForDate(raw);
  if (!fx) return { error: `${raw} is outside the fiscal calendar.`, status: 400 };
  if (!fx.isWeekEnd) return { error: `${raw} is not a fiscal week-ending Sunday.`, status: 400 };
  const { error } = await supa.from("ea_settings").upsert(
    { key: "rvp_commitment_base_anchor", value: { week_end: raw }, updated_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true, anchor_week_end: raw };
}

async function rvpCommitmentSet(supa, user, body) {
  if (!COMMIT_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const region = String(body?.region || "").trim();
  const metric = String(body?.metric || "").trim();
  const target = Number(body?.target_value);
  const note = String(body?.note ?? "").trim().slice(0, 500) || null;
  if (!region) return { error: "region is required.", status: 400 };
  if (!COMMIT_METRICS.has(metric)) return { error: "unknown metric.", status: 400 };
  if (!isFinite(target)) return { error: "target_value must be a number.", status: 400 };
  const { regions } = await callerRegions(supa, user);
  if (!regions.has(region)) return { error: `Region ${region} is outside your scope.`, status: 403 };

  const { data, error } = await supa.from("rvp_commitments").upsert({
    region, metric, target_value: target, note,
    created_by_id: user.id, created_by_email: user.email, updated_at: new Date().toISOString(),
  }, { onConflict: "region,metric" }).select("*").single();
  if (error) {
    if (/rvp_commitments/.test(error.message)) return { error: "Run migration 0258 first (rvp_commitments table is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { row: data };
}

async function rvpCommitmentDelete(supa, user, body) {
  if (!COMMIT_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const region = String(body?.region || "").trim();
  const metric = String(body?.metric || "").trim();
  if (!region || !COMMIT_METRICS.has(metric)) return { error: "region and a valid metric are required.", status: 400 };
  const { regions } = await callerRegions(supa, user);
  if (!regions.has(region)) return { error: "That region is outside your scope.", status: 403 };
  const { error } = await supa.from("rvp_commitments").delete().eq("region", region).eq("metric", metric);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// ── No-GM labor credit management (SDO and above) ────────────────────
// A store without a GM gets a weekly labor credit (default 880.00, in
// ea_settings.no_gm_weekly_credit). SDO+ tag a store with a reason —
// LOA / No GM / In Training — and a start date; ending the record stops
// the credit. The credit itself is applied in _lib/trainingCredit.js.
// ── Corporate training-class labor credit ────────────────────────────────────
// Upload a CSV of class attendees (by store), then apply a per-day credit to a
// chosen week's selected days. Credit lands via loadLaborCredits like the others.
const CORP_TRAINING_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);

// Parse a CSV of attendees into per-store counts. Store number comes from a
// header column matching store/unit/location/number, else the most-numeric
// column when there's no recognizable header. A store appearing N times = N
// attendees (credited N x the daily rate).
function parseCorpTrainingCsv(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], error: "The file is empty." };
  const splitRow = (line) => {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = splitRow(lines[0]).map((h) => h.toLowerCase());
  const looksHeader = header.some((h) => /store|unit|location|number|#|name|attendee|employee/.test(h));
  let storeCol = -1, nameCol = -1;
  if (looksHeader) {
    storeCol = header.findIndex((h) => /store|unit|location|number|#/.test(h));
    nameCol = header.findIndex((h) => /name|attendee|employee/.test(h));
  }
  const bodyLines = looksHeader ? lines.slice(1) : lines;
  const parsed = bodyLines.map(splitRow);
  if (storeCol === -1) {
    const width = Math.max(...parsed.map((r) => r.length), 1);
    let best = 0, bestScore = -1;
    for (let c = 0; c < width; c++) {
      const score = parsed.filter((r) => /^\d{2,6}$/.test(String(r[c] || "").replace(/\D/g, ""))).length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    storeCol = best;
  }
  const byStore = new Map();
  for (const r of parsed) {
    const sn = String(r[storeCol] || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (!/^\d{2,6}$/.test(sn)) continue;
    const name = nameCol >= 0 ? String(r[nameCol] || "").trim() : "";
    const e = byStore.get(sn) || { store_number: sn, count: 0, names: [] };
    e.count += 1;
    if (name) e.names.push(name);
    byStore.set(sn, e);
  }
  return { rows: [...byStore.values()] };
}

async function corpTrainingParse(supa, user, body) {
  if (!CORP_TRAINING_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const { rows, error } = parseCorpTrainingCsv(body?.csv);
  if (error) return { error, status: 400 };
  if (!rows.length) return { error: "No store numbers found in the file.", status: 400 };
  const visible = await resolveVisibleStoreRows(supa, user);
  const nameByNumber = new Map(visible.map((s) => [String(s.number), s.name]));
  const inScope = new Set(visible.map((s) => String(s.number)));
  const stores = rows.map((r) => ({
    store_number: r.store_number,
    count: r.count,
    store_name: nameByNumber.get(r.store_number) ?? null,
    in_scope: inScope.has(r.store_number),
  })).sort((a, b) => Number(a.store_number) - Number(b.store_number));
  return {
    stores,
    total_attendees: stores.reduce((a, s) => a + s.count, 0),
    unknown: stores.filter((s) => !s.in_scope).map((s) => s.store_number),
    default_daily: await corpTrainingDailyRate(supa),
  };
}

async function corpTrainingApply(supa, user, body) {
  if (!CORP_TRAINING_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const label = String(body?.label ?? "").trim().slice(0, 120) || null;
  const daily = Number(body?.daily_amount);
  const dailyAmount = isFinite(daily) && daily > 0 ? Math.round(daily * 100) / 100 : CORP_TRAINING_DEFAULT_DAILY;
  const dates = Array.isArray(body?.dates)
    ? [...new Set(body.dates.map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && parseIso(d)))]
    : [];
  if (!dates.length) return { error: "Select at least one day to apply the credit to.", status: 400 };
  const rawStores = Array.isArray(body?.stores) ? body.stores : [];
  const visible = await resolveVisibleStoreRows(supa, user);
  const inScope = new Set(visible.map((s) => String(s.number)));
  const stores = [];
  for (const s of rawStores) {
    const sn = String(s?.store_number ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (!sn || !inScope.has(sn)) continue; // drop out-of-scope stores
    stores.push({ store_number: sn, count: Math.max(1, Math.round(Number(s?.count) || 1)) });
  }
  if (!stores.length) return { error: "No in-scope stores to apply the credit to.", status: 400 };
  const { data, error } = await supa.from("corporate_training_credits").insert({
    label, daily_amount: dailyAmount, dates: dates.sort(), stores,
    created_by_id: user.id, created_by_email: user.email,
  }).select("*").single();
  if (error) {
    if (/corporate_training_credits/.test(error.message)) return { error: "Run migration 0278 first (corporate_training_credits table is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { row: data };
}

async function corpTrainingList(supa, user) {
  if (!CORP_TRAINING_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const visible = await resolveVisibleStoreRows(supa, user);
  const inScope = new Set(visible.map((s) => String(s.number)));
  const [{ data, error }, defaultDaily] = await Promise.all([
    supa.from("corporate_training_credits").select("*").order("created_at", { ascending: false }).limit(200),
    corpTrainingDailyRate(supa),
  ]);
  if (error) {
    if (/corporate_training_credits/.test(error.message)) return { rows: [], default_daily: defaultDaily };
    return { error: error.message, status: 500 };
  }
  const rows = [];
  for (const b of data || []) {
    const stores = (Array.isArray(b.stores) ? b.stores : []).filter((s) => inScope.has(String(s.store_number)));
    if (!stores.length) continue;
    const dates = Array.isArray(b.dates) ? [...b.dates].sort() : [];
    rows.push({
      id: b.id, label: b.label, daily_amount: Number(b.daily_amount),
      dates, start: dates[0] ?? null, end: dates[dates.length - 1] ?? null,
      store_count: stores.length,
      attendees: stores.reduce((a, s) => a + Math.max(1, Math.round(Number(s.count) || 1)), 0),
      stores, created_at: b.created_at, created_by_email: b.created_by_email,
    });
  }
  return { rows, default_daily: defaultDaily };
}

async function corpTrainingDelete(supa, user, body) {
  if (!CORP_TRAINING_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id is required.", status: 400 };
  const { error } = await supa.from("corporate_training_credits").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function corpTrainingRateSet(supa, user, body) {
  if (!new Set(["vp", "coo", "admin"]).has(roleOf(user))) return { error: "VP and above only.", status: 403 };
  const amt = Number(body?.amount);
  if (!isFinite(amt) || amt <= 0) return { error: "amount must be a positive number.", status: 400 };
  const rate = Math.round(amt * 100) / 100;
  const { error } = await supa.from("ea_settings").upsert(
    { key: "corp_training_daily_credit", value: { amount: rate }, updated_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true, amount: rate };
}

const NO_GM_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);
const NO_GM_REASONS = new Set(["loa", "no_gm", "in_training"]);

async function noGmList(supa, user) {
  if (!NO_GM_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.length) return { rows: [], weekly: 880 };
  const numbers = [...new Set(visible.map((s) => String(s.number)))];
  const nameByNumber = new Map(visible.map((s) => [String(s.number), s.name]));
  const [{ data, error }, { data: rateRow }, orgMap] = await Promise.all([
    supa.from("no_gm_credits").select("*").in("store_number", numbers)
      .order("start_date", { ascending: false }).limit(500),
    supa.from("ea_settings").select("value").eq("key", "no_gm_weekly_credit").maybeSingle(),
    resolveOrg(supa, numbers), // region + rvpName per store, so the UI can sort by RVP
  ]);
  if (error) {
    if (/no_gm_credits/.test(error.message)) return { error: "Run migration 0236 first (no_gm_credits table is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  const weekly = (() => { const a = Number(rateRow?.value?.amount); return isFinite(a) && a > 0 ? a : 880; })();
  const today = isoOf(new Date());
  const rows = (data || []).map((r) => {
    const org = orgMap.get(String(r.store_number));
    return {
      ...r,
      store_name: nameByNumber.get(String(r.store_number)) ?? null,
      region: org?.region ?? null,
      rvp_name: org?.rvpName ?? null,
      active: r.start_date <= today && (!r.end_date || r.end_date >= today),
    };
  });
  return { rows, weekly };
}

async function noGmAdd(supa, user, body) {
  if (!NO_GM_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const storeNumber = String(body?.store_number || "").trim();
  const reason = String(body?.reason || "").trim();
  const startDate = String(body?.start_date || "").trim();
  const endDate = body?.end_date ? String(body.end_date).trim() : null;
  const note = String(body?.note ?? "").trim().slice(0, 500) || null;
  if (!NO_GM_REASONS.has(reason)) return { error: "reason must be loa, no_gm, or in_training.", status: 400 };
  if (!parseIso(startDate)) return { error: "valid start_date is required.", status: 400 };
  if (endDate && (!parseIso(endDate) || endDate < startDate)) return { error: "end_date must be on/after start_date.", status: 400 };

  const visible = await resolveVisibleStoreRows(supa, user);
  const storeRow = visible.find((s) => String(s.number) === storeNumber) || null;
  if (!storeRow) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  // One open tag per store at a time — end the existing one first.
  const { data: open } = await supa.from("no_gm_credits")
    .select("id").eq("store_number", storeNumber).is("end_date", null).limit(1);
  if (open?.length && !endDate) {
    return { error: `Store ${storeNumber} already has an open no-GM tag — end it first.`, status: 409 };
  }

  const { data, error } = await supa.from("no_gm_credits").insert({
    store_number: storeNumber,
    reason,
    start_date: startDate,
    end_date: endDate,
    note,
    created_by_id: user.id,
    created_by_email: user.email,
  }).select("*").single();
  if (error) {
    if (/no_gm_credits/.test(error.message)) return { error: "Run migration 0236 first (no_gm_credits table is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { row: data };
}

async function noGmEnd(supa, user, body) {
  if (!NO_GM_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const id = String(body?.id || "").trim();
  const endDate = String(body?.end_date || "").trim();
  if (!id) return { error: "id is required.", status: 400 };
  if (!parseIso(endDate)) return { error: "valid end_date is required.", status: 400 };
  const { data: rec } = await supa.from("no_gm_credits").select("id, store_number, start_date").eq("id", id).maybeSingle();
  if (!rec) return { error: "Record not found.", status: 404 };
  if (endDate < rec.start_date) return { error: "end_date must be on/after the start date.", status: 400 };
  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.some((s) => String(s.number) === String(rec.store_number))) {
    return { error: "That store is outside your scope.", status: 403 };
  }
  const { error } = await supa.from("no_gm_credits")
    .update({ end_date: endDate, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// Edit a tag at any point in its life (active, ended, or upcoming). Every edit
// records an audit entry in edit_log — who, when, a required note, and a diff of
// what changed — so a corrected or reopened credit keeps its history.
async function noGmUpdate(supa, user, body) {
  if (!NO_GM_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id is required.", status: 400 };
  const reason = String(body?.reason || "").trim();
  const startDate = String(body?.start_date || "").trim();
  const endDate = body?.end_date ? String(body.end_date).trim() : null;
  const note = String(body?.note ?? "").trim().slice(0, 500) || null;
  const editNote = String(body?.edit_note ?? "").trim().slice(0, 500);
  if (!NO_GM_REASONS.has(reason)) return { error: "reason must be loa, no_gm, or in_training.", status: 400 };
  if (!parseIso(startDate)) return { error: "valid start_date is required.", status: 400 };
  if (endDate && (!parseIso(endDate) || endDate < startDate)) return { error: "end_date must be on/after start_date.", status: 400 };
  if (!editNote) return { error: "Add a note describing the edit.", status: 400 };

  const { data: rec } = await supa.from("no_gm_credits")
    .select("id, store_number, reason, start_date, end_date, note, edit_log").eq("id", id).maybeSingle();
  if (!rec) return { error: "Record not found.", status: 404 };
  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.some((s) => String(s.number) === String(rec.store_number))) {
    return { error: "That store is outside your scope.", status: 403 };
  }
  // Reopening (clearing the end date) must not collide with another open tag.
  if (!endDate) {
    const { data: openOthers } = await supa.from("no_gm_credits")
      .select("id").eq("store_number", rec.store_number).is("end_date", null).neq("id", id).limit(1);
    if (openOthers?.length) return { error: `Store ${rec.store_number} already has another open tag — end it first.`, status: 409 };
  }

  // Diff old vs new for the audit entry.
  const next = { reason, start_date: startDate, end_date: endDate, note };
  const changes = {};
  for (const [k, v] of Object.entries(next)) {
    const before = rec[k] ?? null;
    const after = v ?? null;
    if (String(before) !== String(after)) changes[k] = { from: before, to: after };
  }
  const entry = { at: new Date().toISOString(), by_id: user.id, by_email: user.email, note: editNote, changes };
  const edit_log = (Array.isArray(rec.edit_log) ? rec.edit_log : []).concat(entry);

  const { data, error } = await supa.from("no_gm_credits").update({
    reason, start_date: startDate, end_date: endDate, note, edit_log,
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error) {
    if (/edit_log/.test(error.message)) return { error: "Run migration 0262 first (edit_log column is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { row: data };
}

async function noGmDelete(supa, user, body) {
  if (!NO_GM_ROLES.has(roleOf(user))) return { error: "SDO and above only.", status: 403 };
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id is required.", status: 400 };
  const { data: rec } = await supa.from("no_gm_credits").select("id, store_number").eq("id", id).maybeSingle();
  if (!rec) return { error: "Record not found.", status: 404 };
  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.some((s) => String(s.number) === String(rec.store_number))) {
    return { error: "That store is outside your scope.", status: 403 };
  }
  const { error } = await supa.from("no_gm_credits").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function noGmRateSet(supa, user, body) {
  if (roleOf(user) !== "admin") return { error: "Admins only.", status: 403 };
  const amount = round2(numv(body?.amount));
  if (amount <= 0 || amount > 100000) return { error: "Enter a weekly amount above $0.", status: 400 };
  const { error } = await supa.from("ea_settings").upsert(
    { key: "no_gm_weekly_credit", value: { amount }, updated_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true, amount };
}

// ── GM support-hours credit (SDO+) — a GM supporting other stores gets weekly
// hours credited to their own store; mirrors the no-GM tag CRUD.
async function gmSupportList(supa, user) {
  if (roleOf(user) !== "admin") return { error: "Admins only.", status: 403 };
  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.length) return { rows: [] };
  const numbers = [...new Set(visible.map((s) => String(s.number)))];
  const nameByNumber = new Map(visible.map((s) => [String(s.number), s.name]));
  const { data, error } = await supa.from("gm_support_hours_credits").select("*").in("store_number", numbers)
    .order("start_date", { ascending: false }).limit(500);
  if (error) {
    if (/gm_support_hours_credits/.test(error.message)) return { error: "Run migration 0257 first (gm_support_hours_credits table is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  const today = isoOf(new Date());
  const rows = (data || []).map((r) => ({
    ...r,
    store_name: nameByNumber.get(String(r.store_number)) ?? null,
    active: r.start_date <= today && (!r.end_date || r.end_date >= today),
  }));
  return { rows };
}

// A GM-support tag is one of two bases: fixed weekly hours OR a % buffer of
// sales (credited off labor). Exactly one; `basis` disambiguates ("hours" | "buffer").
function parseGmSupportBasis(body) {
  const basis = String(body?.basis || (numv(body?.buffer_pct) > 0 && !(numv(body?.weekly_hours) > 0) ? "buffer" : "hours"));
  if (basis === "buffer") {
    const bufferPct = round2(numv(body?.buffer_pct));
    if (!(bufferPct > 0 && bufferPct <= 100)) return { error: "Buffer % must be between 0 and 100." };
    return { fields: { weekly_hours: null, buffer_pct: bufferPct } };
  }
  const weeklyHours = round2(numv(body?.weekly_hours));
  if (!(weeklyHours > 0 && weeklyHours <= 80)) return { error: "Weekly hours must be between 0 and 80." };
  return { fields: { weekly_hours: weeklyHours, buffer_pct: null } };
}

async function gmSupportAdd(supa, user, body) {
  if (roleOf(user) !== "admin") return { error: "Admins only.", status: 403 };
  const storeNumber = String(body?.store_number || "").trim();
  const startDate = String(body?.start_date || "").trim();
  const endDate = body?.end_date ? String(body.end_date).trim() : null;
  const note = String(body?.note ?? "").trim().slice(0, 500) || null;
  const basis = parseGmSupportBasis(body);
  if (basis.error) return { error: basis.error, status: 400 };
  if (!parseIso(startDate)) return { error: "valid start_date is required.", status: 400 };
  if (endDate && (!parseIso(endDate) || endDate < startDate)) return { error: "end_date must be on/after start_date.", status: 400 };

  const visible = await resolveVisibleStoreRows(supa, user);
  const storeRow = visible.find((s) => String(s.number) === storeNumber) || null;
  if (!storeRow) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const { data: open } = await supa.from("gm_support_hours_credits")
    .select("id").eq("store_number", storeNumber).is("end_date", null).limit(1);
  if (open?.length && !endDate) {
    return { error: `Store ${storeNumber} already has an open support-hours tag — end it first.`, status: 409 };
  }

  const { data, error } = await supa.from("gm_support_hours_credits").insert({
    store_number: storeNumber, ...basis.fields, start_date: startDate, end_date: endDate, note,
    created_by_id: user.id, created_by_email: user.email,
  }).select("*").single();
  if (error) {
    if (/gm_support_hours_credits/.test(error.message)) return { error: "Run migration 0257 first (gm_support_hours_credits table is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { row: data };
}

// Edit an existing tag in place — hours / start / end / note. Admin only.
async function gmSupportUpdate(supa, user, body) {
  if (roleOf(user) !== "admin") return { error: "Admins only.", status: 403 };
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id is required.", status: 400 };
  const startDate = String(body?.start_date || "").trim();
  const endDate = body?.end_date ? String(body.end_date).trim() : null;
  const note = String(body?.note ?? "").trim().slice(0, 500) || null;
  const basis = parseGmSupportBasis(body);
  if (basis.error) return { error: basis.error, status: 400 };
  if (!parseIso(startDate)) return { error: "valid start_date is required.", status: 400 };
  if (endDate && (!parseIso(endDate) || endDate < startDate)) return { error: "end_date must be on/after start_date.", status: 400 };

  const { data: rec } = await supa.from("gm_support_hours_credits").select("id, store_number").eq("id", id).maybeSingle();
  if (!rec) return { error: "Record not found.", status: 404 };
  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.some((s) => String(s.number) === String(rec.store_number))) return { error: "That store is outside your scope.", status: 403 };

  // Keep the one-open-tag-per-store rule: reopening this tag (clearing end_date)
  // is only allowed if no other tag for the store is already open.
  if (!endDate) {
    const { data: open } = await supa.from("gm_support_hours_credits")
      .select("id").eq("store_number", rec.store_number).is("end_date", null).neq("id", id).limit(1);
    if (open?.length) return { error: `Store ${rec.store_number} already has another open support-hours tag — end it first.`, status: 409 };
  }

  const { data, error } = await supa.from("gm_support_hours_credits")
    .update({ ...basis.fields, start_date: startDate, end_date: endDate, note, updated_at: new Date().toISOString() })
    .eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { row: data };
}

async function gmSupportEnd(supa, user, body) {
  if (roleOf(user) !== "admin") return { error: "Admins only.", status: 403 };
  const id = String(body?.id || "").trim();
  const endDate = String(body?.end_date || "").trim();
  if (!id) return { error: "id is required.", status: 400 };
  if (!parseIso(endDate)) return { error: "valid end_date is required.", status: 400 };
  const { data: rec } = await supa.from("gm_support_hours_credits").select("id, store_number, start_date").eq("id", id).maybeSingle();
  if (!rec) return { error: "Record not found.", status: 404 };
  if (endDate < rec.start_date) return { error: "end_date must be on/after the start date.", status: 400 };
  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.some((s) => String(s.number) === String(rec.store_number))) return { error: "That store is outside your scope.", status: 403 };
  const { error } = await supa.from("gm_support_hours_credits").update({ end_date: endDate, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function gmSupportDelete(supa, user, body) {
  if (roleOf(user) !== "admin") return { error: "Admins only.", status: 403 };
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id is required.", status: 400 };
  const { data: rec } = await supa.from("gm_support_hours_credits").select("id, store_number").eq("id", id).maybeSingle();
  if (!rec) return { error: "Record not found.", status: 404 };
  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.some((s) => String(s.number) === String(rec.store_number))) return { error: "That store is outside your scope.", status: 403 };
  const { error } = await supa.from("gm_support_hours_credits").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function teamView(supa, user, params) {
  if (!TEAM_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const empty = { date: null, scope: { stores: 0, dos: [] }, totals: null, startLevel: "district", levels: { region: [], area: [], district: [], store: [] }, missing: [] };

  const visible = await resolveVisibleStoreRows(supa, user);
  if (!visible.length) return empty;
  const numbers = [...new Set(visible.map((s) => String(s.number)))];

  // Past week → anchor on that week's last captured day (the calendar Sunday
  // often has no capture); current week (no date) → the latest captured day.
  const requested = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  const anchor = requested
    ? ((await weekLastCaptured(supa, numbers, requested)) || requested)
    : await latestBusinessDate(supa);
  if (!anchor) return empty;
  // Weeks elapsed in the current fiscal period — the Ranker divides its
  // per-store hours-over by this, so the PTD Hrs/Store aggregates below match.
  const weeksInPeriod = fiscalForDate(anchor)?.weekInPeriod || null;
  // Toggle: per-week rate (÷ weeks elapsed) vs. raw period total (÷ 1).
  const weeklyRate = await getLaborHrsWeekly(supa);
  const hrsWeeks = weeklyRate ? weeksInPeriod : 1;

  const [{ data: rows }, { data: reviews }] = await Promise.all([
    supa.from("labor_v2_daily").select("*").eq("business_date", anchor).in("store_number", numbers),
    supa.from("labor_reviews").select("store_number, note, root_cause").eq("business_date", anchor).in("store_number", numbers),
  ]);
  // Load each credit type separately so the Team view can show how much each
  // District / Area / Region / Company is using in credits (with a per-type
  // breakdown), then merge them exactly as loadLaborCredits does to adjust rows.
  const [tcMap, ptoMap, noGmMap, gmSupMap, corpMap] = await Promise.all([
    loadTrainingCreditDates(supa, numbers),
    loadGmPtoCreditDates(supa, numbers),
    loadNoGmCreditDates(supa, numbers),
    loadGmSupportCreditDates(supa, numbers),
    loadCorporateTrainingCreditDates(supa, numbers),
  ]);
  const mergedCredits = new Map();
  for (const src of [tcMap, ptoMap, noGmMap, gmSupMap, corpMap]) for (const [sn, arr] of src) mergedCredits.set(sn, (mergedCredits.get(sn) || []).concat(arr));
  applyCreditsToRows(rows || [], mergedCredits);
  // Period-to-date credit $ per store (periodStart → anchor), summed per node.
  const periodStart = fiscalForDate(anchor)?.periodStart ?? anchor;
  const creditPtd = (map, sn) => (map.get(sn) || []).reduce((a, c) => (c.date >= periodStart && c.date <= anchor ? a + numv(c.amount) : a), 0);
  const creditsFor = (nums) => {
    const no_gm = round2(nums.reduce((a, n) => a + creditPtd(noGmMap, String(n)), 0));
    const pto = round2(nums.reduce((a, n) => a + creditPtd(ptoMap, String(n)), 0));
    const training = round2(nums.reduce((a, n) => a + creditPtd(tcMap, String(n)), 0));
    const gm_support = round2(nums.reduce((a, n) => a + creditPtd(gmSupMap, String(n)), 0));
    const training_class = round2(nums.reduce((a, n) => a + creditPtd(corpMap, String(n)), 0));
    return { no_gm, pto, training, gm_support, training_class, total: round2(no_gm + pto + training + gm_support + training_class) };
  };
  const reviewByStore = new Map((reviews || []).map((r) => [String(r.store_number), r]));
  const orgMap = await resolveOrg(supa, numbers);

  // Visible stores with no Expressway poll for this date (no row, or a row
  // with no daily sales) — surfaced so the numbers can be flagged as skewed.
  // Only flag stores that resolve into the Sonic org tree: non-Sonic brands
  // (Apricus / Little Caesars) and corporate/hold stores like #8100 sit outside
  // it and never receive Expressway polling, so they'd falsely inflate the skew
  // count. `district` is null for exactly those, which is our filter.
  const polled = new Set((rows || []).filter((r) => r.net_sales != null).map((r) => String(r.store_number)));
  const missing = visible
    .filter((s) => !polled.has(String(s.number)))
    .filter((s) => orgMap.get(String(s.number))?.district)
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
      day: teamBand(rs, ""), wtd: teamBand(rs, "wtd_"), ptd: withRankerHrs(teamBand(rs, "ptd_"), rs, hrsWeeks),
      storesOver: rs.filter(storeOver).length,
      notesDue: rs.filter((r) => storeOver(r) && !reviewByStore.get(String(r.store_number))).length,
      credits: creditsFor(rs.map((r) => r.store_number)),
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
      day, wtd: teamBand([r], "wtd_"), ptd: withRankerHrs(teamBand([r], "ptd_"), [r], hrsWeeks),
      status: day.status,
      note_due: day.status === "over" && !explained,
      explained,
      note: review?.note ?? null,
      root_cause: review?.root_cause ?? null,
      credits: creditsFor([r.store_number]),
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
      day: teamBand(inScope, ""), wtd: teamBand(inScope, "wtd_"), ptd: withRankerHrs(teamBand(inScope, "ptd_"), inScope, hrsWeeks),
      storesOver: storeRows.filter((s) => s.status === "over").length,
      notesDue: storeRows.filter((s) => s.note_due).length,
      notesExplained: storeRows.filter((s) => s.explained).length,
      credits: creditsFor(inScope.map((r) => r.store_number)),
    },
    startLevel,
    levels,
    missing,
    hrs_weekly_rate: weeklyRate,
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

// ── Public labor share links (per-RVP / company drill-down) ──────────
// Mints/reads live under labor-v2 but the READ (`shared-labor`) is public — the
// token is the credential. Minting is limited to above-store leadership.
const LABOR_SHARE_ROLES = new Set(["admin", "vp", "coo"]);

// Corporate / hold stores are excluded from the shared labor sheet — they're not
// operating restaurants and shouldn't skew a scope's numbers.
const CORPORATE_STORE_NUMBERS = new Set(["8100"]);

// Rollup $ over excludes UNDER-chart stores: a store beating its chart (negative
// $ over) is zeroed out of the sum, so one great store can't offset — and mask —
// a district's real overspend. A single store keeps its own net (can go green
// negative). hours over uses teamBand's per-unit figure (already positive-only).
function dollarsOverForNode(rows, prefix, net) {
  if (rows.length <= 1) return net;
  const sum = rows.reduce((a, r) => {
    const over = numv(r[prefix + "labor_cost"]) - numv(r[prefix + "target_labor_pct"]) * numv(r[prefix + "net_sales"]);
    return a + (over > 0 ? over : 0);
  }, 0);
  return round2(sum);
}

function liteBand(rows, prefix) {
  const b = teamBand(rows, prefix);
  return {
    labor_pct: b.labor_pct, target_pct: b.target_pct, variance_pts: b.variance_pts,
    dollars_over: dollarsOverForNode(rows, prefix, b.dollars_over_chart),
    hours_over: b.hours_over_chart, act_vs_sched: b.act_vs_sched,
  };
}

// Week-over-week hours-over flag — apples-to-apples: this week's WTD hours over
// (Mon→anchor) vs last week THROUGH THE SAME WEEKDAY. Last week's daily row on
// the same weekday carries cumulative wtd_ fields (Mon→that day), so both sides
// cover the same number of days. Uses the same hours_over_chart metric as the
// hub. Improving = fewer hours over than last week.
function hoursOverTrend(rows, lastWkRows) {
  const thisWtd = teamBand(rows, "wtd_").hours_over_chart;
  const lastWtd = teamBand(lastWkRows, "wtd_").hours_over_chart;
  const delta = thisWtd != null && lastWtd != null ? round1(thisWtd - lastWtd) : null;
  return { this_wtd: thisWtd, last_week: lastWtd, delta, improving: delta == null ? null : delta < 0 };
}

// Build the public drill-down for a scope (whole company or one region).
async function laborSharePayload(supa, { scopeKind, regionName, label, numbers: only } = {}) {
  const anchor = await latestBusinessDate(supa);
  const empty = {
    date: null, scope: { kind: scopeKind, region: regionName ?? null }, label: label ?? null,
    company: null, levels: { region: [], area: [], district: [], store: [] },
  };
  if (!anchor) return empty;

  // `only` restricts to a caller's visible stores (authenticated Labor File);
  // omitted → the whole Sonic company (public share link).
  let storeQ = supa.from("stores").select("number, name").eq("is_active", true).or("brand.eq.sonic,brand.is.null");
  if (only && only.length) storeQ = storeQ.in("number", [...new Set(only.map(String))]);
  const { data: storeRows } = await storeQ;
  let numbers = [...new Set((storeRows || []).map((s) => String(s.number)))];
  const nameByNumber = new Map((storeRows || []).map((s) => [String(s.number), s.name]));
  if (!numbers.length) return { ...empty, date: anchor };
  const orgMap = await resolveOrg(supa, numbers);

  // Only stores that resolve into the Sonic org tree; region links narrow to one.
  numbers = numbers.filter((n) => orgMap.get(n)?.region && !CORPORATE_STORE_NUMBERS.has(n));
  if (scopeKind === "region" && regionName) numbers = numbers.filter((n) => orgMap.get(n)?.region === regionName);
  if (!numbers.length) return { ...empty, date: anchor };

  // Same weekday one week back — its cumulative wtd_ fields give last week
  // Mon→(same day), the apples-to-apples comparison for this week's WTD.
  const lastWeekDate = isoOf(shiftDays(parseIso(anchor), -7));
  // Load each credit type separately so we can show the breakdown, then
  // merge them exactly as loadLaborCredits does to adjust the labor rows.
  const [{ data: daily }, { data: lastWk }, tcMap, ptoMap, noGmMap, gmSupMap, corpMap] = await Promise.all([
    supa.from("labor_v2_daily").select("*").eq("business_date", anchor).in("store_number", numbers),
    // Include business_date so applyCreditsToRows can window last week's own
    // WTD credits (its weekStart → that day) — otherwise last week's WTD hours
    // over is uncredited while this week's is, skewing the Improving flag.
    supa.from("labor_v2_daily").select("business_date, store_number, net_sales, labor_cost, labor_hours, wtd_net_sales, wtd_labor_cost, wtd_labor_hours, wtd_target_labor_pct, ptd_net_sales, ptd_labor_cost, ptd_labor_hours")
      .eq("business_date", lastWeekDate).in("store_number", numbers),
    loadTrainingCreditDates(supa, numbers),
    loadGmPtoCreditDates(supa, numbers),
    loadNoGmCreditDates(supa, numbers),
    loadGmSupportCreditDates(supa, numbers),
    loadCorporateTrainingCreditDates(supa, numbers),
  ]);
  const mergedCredits = new Map();
  for (const src of [tcMap, ptoMap, noGmMap, gmSupMap, corpMap]) for (const [sn, arr] of src) mergedCredits.set(sn, (mergedCredits.get(sn) || []).concat(arr));
  applyCreditsToRows(daily || [], mergedCredits);
  // Credit last week's rows the same way, so the WoW comparison is like-for-like.
  applyCreditsToRows(lastWk || [], mergedCredits);
  const dailyByStore = new Map((daily || []).map((r) => [String(r.store_number), r]));
  const lastWkByStore = new Map((lastWk || []).map((r) => [String(r.store_number), r]));

  // Period-to-date credit $ by store, per type (window matches applyCreditsToRows'
  // PTD band: periodStart → anchor).
  const periodStart = fiscalForDate(anchor)?.periodStart ?? anchor;
  const creditPtd = (map, sn) => (map.get(sn) || []).reduce((a, c) => (c.date >= periodStart && c.date <= anchor ? a + numv(c.amount) : a), 0);

  // Rollup participates only for stores that actually polled today.
  const activeNums = numbers.filter((n) => dailyByStore.has(n));
  if (!activeNums.length) return { ...empty, date: anchor };

  const nodeFor = (nums, level, name, leader, parents) => {
    const rows = nums.map((n) => dailyByStore.get(n)).filter(Boolean);
    const lwRows = nums.map((n) => lastWkByStore.get(n)).filter(Boolean);
    return {
      level, name, leader: leader ?? null, storeCount: nums.length,
      region: parents.region ?? null, area: parents.area ?? null, district: parents.district ?? null,
      store_number: level === "store" ? nums[0] : undefined,
      store_name: level === "store" ? (nameByNumber.get(nums[0]) || `#${nums[0]}`) : undefined,
      daily: liteBand(rows, ""),
      wtd: liteBand(rows, "wtd_"),
      ptd: liteBand(rows, "ptd_"),
      hours_trend: hoursOverTrend(rows, lwRows),
      credits: {
        no_gm: round2(nums.reduce((a, n) => a + creditPtd(noGmMap, n), 0)),
        pto: round2(nums.reduce((a, n) => a + creditPtd(ptoMap, n), 0)),
        training: round2(nums.reduce((a, n) => a + creditPtd(tcMap, n), 0)),
        gm_support: round2(nums.reduce((a, n) => a + creditPtd(gmSupMap, n), 0)),
        training_class: round2(nums.reduce((a, n) => a + creditPtd(corpMap, n), 0)),
      },
    };
  };

  const push = (map, key, n) => (map.get(key) || map.set(key, []).get(key)).push(n);
  const regionMap = new Map(), areaMap = new Map(), districtMap = new Map();
  for (const n of activeNums) {
    const o = orgMap.get(n); if (!o) continue;
    push(regionMap, o.region, n);
    push(areaMap, `${o.region}|||${o.area}`, n);
    push(districtMap, `${o.region}|||${o.area}|||${o.district}`, n);
  }
  const leaderOf = (nums, field) => { for (const n of nums) { const v = orgMap.get(n)?.[field]; if (v) return v; } return null; };
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true });

  const region = [...regionMap].map(([rn, nums]) => nodeFor(nums, "region", rn, leaderOf(nums, "rvpName"), { region: rn })).sort(byName);
  const area = [...areaMap].map(([k, nums]) => { const [rn, an] = k.split("|||"); return nodeFor(nums, "area", an, leaderOf(nums, "sdoName"), { region: rn, area: an }); }).sort(byName);
  const district = [...districtMap].map(([k, nums]) => { const [rn, an, dn] = k.split("|||"); return nodeFor(nums, "district", dn, leaderOf(nums, "doName"), { region: rn, area: an, district: dn }); }).sort(byName);
  const store = activeNums.map((n) => { const o = orgMap.get(n); return nodeFor([n], "store", nameByNumber.get(n) || `#${n}`, o?.gmName || null, { region: o.region, area: o.area, district: o.district }); }).sort(byName);

  const company = nodeFor(
    activeNums, "company",
    scopeKind === "region" ? (regionName ?? "Region") : "SOAR — Company",
    scopeKind === "region" ? leaderOf(activeNums, "rvpName") : null, {},
  );

  return { date: anchor, scope: { kind: scopeKind, region: regionName ?? null }, label: label ?? null, company, levels: { region, area, district, store } };
}

// PUBLIC — resolve a share token to its live drill-down. Token is the credential.
async function sharedLabor(supa, token) {
  const t = String(token || "").trim();
  if (!t) return { error: "token required", status: 400 };
  const { data: share } = await supa.from("labor_share_tokens")
    .select("id, scope_kind, region_id, label, is_active").eq("token", t).maybeSingle();
  if (!share || !share.is_active) return { error: "This labor link is no longer active.", status: 404 };
  let regionName = null;
  if (share.region_id) {
    const { data: r } = await supa.from("regions").select("name").eq("id", share.region_id).maybeSingle();
    regionName = r?.name ?? null;
  }
  try { await supa.from("labor_share_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", share.id); } catch { /* ignore */ }
  return laborSharePayload(supa, { scopeKind: share.scope_kind, regionName, label: share.label });
}

// AUTHENTICATED — the same drill-down the shared link produces (all columns +
// credits), scoped to the caller's visible stores (org-wide roles get the whole
// company). Powers the hub "Labor File" download so it matches the shared version.
async function laborFile(supa, user) {
  const visible = await resolveVisibleStoreRows(supa, user);
  const numbers = [...new Set(visible.map((s) => String(s.number)))];
  if (!numbers.length) {
    return { date: null, scope: { kind: "company", region: null }, label: null, company: null, levels: { region: [], area: [], district: [], store: [] } };
  }
  return laborSharePayload(supa, { scopeKind: "company", numbers });
}

// PUBLIC — one store's current-week daily labor + any filed miss reason, for the
// store popup on the shared sheet. Scope-checked against the token (region links
// can only open their own stores). Read-only; reasons are filed in the hub.
async function sharedLaborStore(supa, token, storeNumber) {
  const t = String(token || "").trim();
  const num = String(storeNumber || "").trim();
  if (!t || !num) return { error: "token and store required", status: 400 };
  const { data: share } = await supa.from("labor_share_tokens")
    .select("scope_kind, region_id, is_active").eq("token", t).maybeSingle();
  if (!share || !share.is_active) return { error: "This labor link is no longer active.", status: 404 };
  let regionName = null;
  if (share.region_id) {
    const { data: r } = await supa.from("regions").select("name").eq("id", share.region_id).maybeSingle();
    regionName = r?.name ?? null;
  }
  const org = (await resolveOrg(supa, [num])).get(num);
  if (!org || !org.region || CORPORATE_STORE_NUMBERS.has(num)) return { error: "Store not found.", status: 404 };
  if (share.scope_kind === "region" && org.region !== regionName) return { error: "Store is outside this link's scope.", status: 403 };

  const anchor = await latestBusinessDate(supa);
  if (!anchor) return { store_number: num, store_name: org.store, days: [] };
  const week = weekDates(parseIso(anchor)).filter((d) => d <= anchor);

  const [{ data: rows }, { data: reviews }, { data: st }] = await Promise.all([
    supa.from("labor_v2_daily").select("*").eq("store_number", num).in("business_date", week),
    supa.from("labor_reviews").select("business_date, note, root_cause").eq("store_number", num).in("business_date", week),
    supa.from("stores").select("latitude, longitude").eq("number", num).maybeSingle(),
  ]);
  applyCreditsToRows(rows || [], await loadLaborCredits(supa, [num]));
  const rowByDate = new Map((rows || []).map((r) => [String(r.business_date), r]));
  const reviewByDate = new Map((reviews || []).map((r) => [String(r.business_date), r]));
  const wx = await fetchDailyWeather(st?.latitude, st?.longitude, week[0], week[week.length - 1]);

  const days = week.map((d) => {
    const r = rowByDate.get(d);
    const rev = reviewByDate.get(d) || null;
    const b = r ? teamBand([r], "") : null;
    return {
      date: d,
      polled: !!r,
      labor_pct: b?.labor_pct ?? null,
      target_pct: b?.target_pct ?? null,
      variance_pts: b?.variance_pts ?? null,
      dollars_over: b?.dollars_over_chart ?? null,
      hours_over: b?.hours_over_chart ?? null,
      act_vs_sched: b?.act_vs_sched ?? null,
      root_cause: rev?.root_cause ?? null,
      note: rev?.note ?? null,
      weather: wx.get(d) ?? null,
    };
  });
  return { store_number: num, store_name: org.store, days };
}

// Daily weather (hi/lo °F, precip in, WMO code) for a lat/lng over a date range,
// from Open-Meteo's free forecast API (recent-past dates included, no key). Best-
// effort — returns an empty map on any failure so weather never blocks the popup.
async function fetchDailyWeather(lat, lng, start, end) {
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || !start || !end) return new Map();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}`
      + `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum`
      + `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&start_date=${start}&end_date=${end}`;
    const res = await fetch(url);
    if (!res.ok) return new Map();
    const j = await res.json();
    const t = j?.daily?.time || [], hi = j?.daily?.temperature_2m_max || [], low = j?.daily?.temperature_2m_min || [],
      code = j?.daily?.weather_code || [], pr = j?.daily?.precipitation_sum || [];
    const nOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const m = new Map();
    for (let i = 0; i < t.length; i++) {
      m.set(String(t[i]), { hi: nOrNull(hi[i]), lo: nOrNull(low[i]), code: nOrNull(code[i]), precip_in: nOrNull(pr[i]) });
    }
    return m;
  } catch { return new Map(); }
}

// PUBLIC — file a miss reason + note from the shared sheet's store popup. There's
// no login on a share link, so we attribute it to the typed name and mark it as
// filed via the shared link; the token scope-checks the store.
async function sharedLaborStoreReview(supa, token, body) {
  const t = String(token || "").trim();
  const num = String(body?.store || "").trim();
  const businessDate = String(body?.date || "").trim();
  const note = String(body?.note ?? "").trim().slice(0, 2000);
  const rootCause = body?.root_cause ? String(body.root_cause).trim() : null;
  const filedBy = (String(body?.filed_by ?? "").trim().slice(0, 80) || "Shared link") + " · shared link";
  if (!t) return { error: "token required", status: 400 };
  if (!num || !parseIso(businessDate)) return { error: "store and date are required", status: 400 };
  if (!note) return { error: "A note is required.", status: 400 };
  if (rootCause && !REVIEW_ROOT_CAUSES.has(rootCause)) return { error: "Pick one of the listed reasons.", status: 400 };

  const { data: share } = await supa.from("labor_share_tokens").select("scope_kind, region_id, is_active").eq("token", t).maybeSingle();
  if (!share || !share.is_active) return { error: "This labor link is no longer active.", status: 404 };
  let regionName = null;
  if (share.region_id) { const { data: r } = await supa.from("regions").select("name").eq("id", share.region_id).maybeSingle(); regionName = r?.name ?? null; }
  const org = (await resolveOrg(supa, [num])).get(num);
  if (!org || !org.region || CORPORATE_STORE_NUMBERS.has(num)) return { error: "Store not found.", status: 404 };
  if (share.scope_kind === "region" && org.region !== regionName) return { error: "Store is outside this link's scope.", status: 403 };

  const { data: storeRow } = await supa.from("stores").select("id").eq("number", num).maybeSingle();
  if (!storeRow) return { error: "Store not found.", status: 404 };

  let hoursOver = null;
  try {
    const { data: dayRow } = await supa.from("labor_v2_daily").select("*").eq("store_number", num).eq("business_date", businessDate).maybeSingle();
    if (dayRow) { applyCreditsToRows([dayRow], await loadLaborCredits(supa, [num])); const h = storeHoursOver(dayRow, ""); if (h != null && h > 0) hoursOver = round1(h); }
  } catch { /* best-effort */ }

  const now = new Date().toISOString();
  const row = {
    store_id: storeRow.id, store_number: num, business_date: businessDate,
    reviewed_by_id: null, reviewed_by_email: filedBy, note, acknowledged: true, updated_at: now,
    root_cause: rootCause, hours_over: hoursOver,
  };
  let { error } = await supa.from("labor_reviews").upsert(row, { onConflict: "store_id,business_date" });
  if (error && /root_cause|hours_over/.test(error.message)) {
    delete row.root_cause; delete row.hours_over;
    ({ error } = await supa.from("labor_reviews").upsert(row, { onConflict: "store_id,business_date" }));
  }
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// Shared Week-Trend core — Mon→Sun daily-labor strip for each node at a level
// (region/area/district/store), rolled up. `baseNumbers` is the already-scoped
// store set (token scope for the public link, the caller's visible stores for
// the authenticated Labor File); `orgMap`/`nameByNumber` cover those stores.
// `scopeLabel` names the top "scope total" row when no path filter is applied.
async function weekTrendCore(supa, baseNumbers, orgMap, nameByNumber, params, scopeLabel) {
  const level = ["region", "area", "district", "store"].includes(params.level) ? params.level : "region";
  const latest = await latestBusinessDate(supa);
  const empty = { level, dates: [], week_start: null, has_prev: false, has_next: false, scope_total: null, nodes: [] };
  if (!latest) return empty;
  // Which week to show — a specific Monday-containing date, else the latest.
  const weekOf = /^\d{4}-\d{2}-\d{2}$/.test(String(params.weekOf || "")) ? parseIso(params.weekOf) : parseIso(latest);
  if (!weekOf) return empty;
  const week = weekDates(weekOf); // Mon → Sun
  const weekStart = week[0];
  const currentWeekStart = weekDates(parseIso(latest))[0];

  // Path filter — narrow to the region / market / district being viewed.
  const fReg = params.region ? String(params.region) : null;
  const fArea = params.area ? String(params.area) : null;
  const fDist = params.district ? String(params.district) : null;
  const numbers = baseNumbers.filter((n) => { const o = orgMap.get(n); return o && (!fReg || o.region === fReg) && (!fArea || o.area === fArea) && (!fDist || o.district === fDist); });
  if (!numbers.length) return { ...empty, dates: week, week_start: weekStart };

  // Earliest day with data in this scope — bounds how far back you can page.
  const { data: earliestRow } = await supa.from("labor_v2_daily").select("business_date").in("store_number", numbers).order("business_date", { ascending: true }).limit(1);
  const earliest = earliestRow?.[0]?.business_date || null;
  const has_prev = earliest ? earliest < weekStart : false;
  const has_next = weekStart < currentWeekStart;

  // Per-day fetch (a whole week across a big scope can exceed the 1000-row cap).
  const past = week.filter((d) => d <= latest);
  const perDay = await Promise.all(past.map((d) => supa.from("labor_v2_daily").select("*").eq("business_date", d).in("store_number", numbers).then((r) => r.data || [])));
  const credits = await loadLaborCredits(supa, numbers);
  const rowsByDate = new Map();
  past.forEach((d, i) => { const rows = perDay[i]; applyCreditsToRows(rows, credits); rowsByDate.set(d, new Map(rows.map((r) => [String(r.store_number), r]))); });

  const keyOf = (o) => (level === "region" ? o.region : level === "area" ? o.area : level === "district" ? o.district : null);
  const leaderField = level === "region" ? "rvpName" : level === "area" ? "sdoName" : level === "district" ? "doName" : "gmName";
  const groups = new Map();
  for (const n of numbers) {
    const key = level === "store" ? n : (keyOf(orgMap.get(n)) || "—");
    (groups.get(key) || groups.set(key, []).get(key)).push(n);
  }
  const leaderOf = (nums, field) => { for (const n of nums) { const v = orgMap.get(n)?.[field]; if (v) return v; } return null; };

  const seriesFor = (nums) => week.map((d) => {
    if (d > latest) return { date: d, labor_pct: null, wtd_pct: null, hours_over: null, status: "future" };
    const rows = nums.map((n) => (rowsByDate.get(d) || new Map()).get(n)).filter(Boolean);
    if (!rows.length) return { date: d, labor_pct: null, wtd_pct: null, hours_over: null, status: "missing" };
    const b = teamBand(rows, "");
    // WTD through this day — each store's wtd_ fields are cumulative Mon→d.
    return { date: d, labor_pct: b.labor_pct, wtd_pct: teamBand(rows, "wtd_").labor_pct, hours_over: b.hours_over_chart, status: b.status };
  });

  const nodes = [...groups].map(([key, nums]) => ({
    name: level === "store" ? `#${key} ${nameByNumber.get(key) || ""}`.trim() : key,
    leader: level === "store" ? (orgMap.get(key)?.gmName || null) : leaderOf(nums, leaderField),
    week: seriesFor(nums),
  })).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));

  const scope_total = {
    name: fDist || fArea || fReg || scopeLabel,
    leader: null, week: seriesFor(numbers),
  };
  return { level, dates: week, week_start: weekStart, has_prev, has_next, scope_total, nodes };
}

// PUBLIC — Week Trend for a share token. Scoped to the token + an optional path
// filter, so the popup can show the average per RVP / SDO / DO / store.
async function sharedLaborWeek(supa, token, params) {
  const t = String(token || "").trim();
  if (!t) return { error: "token required", status: 400 };
  const { data: share } = await supa.from("labor_share_tokens").select("scope_kind, region_id, is_active").eq("token", t).maybeSingle();
  if (!share || !share.is_active) return { error: "This labor link is no longer active.", status: 404 };
  let regionName = null;
  if (share.region_id) { const { data: r } = await supa.from("regions").select("name").eq("id", share.region_id).maybeSingle(); regionName = r?.name ?? null; }

  const { data: storeRows } = await supa.from("stores").select("number, name, is_active, brand").eq("is_active", true).or("brand.eq.sonic,brand.is.null");
  let numbers = [...new Set((storeRows || []).map((s) => String(s.number)))];
  const nameByNumber = new Map((storeRows || []).map((s) => [String(s.number), s.name]));
  const orgMap = await resolveOrg(supa, numbers);
  numbers = numbers.filter((n) => orgMap.get(n)?.region && !CORPORATE_STORE_NUMBERS.has(n));
  if (share.scope_kind === "region" && regionName) numbers = numbers.filter((n) => orgMap.get(n)?.region === regionName);
  return weekTrendCore(supa, numbers, orgMap, nameByNumber, params, share.scope_kind === "region" ? (regionName || "Region") : "Company");
}

// AUTHENTICATED — Week Trend scoped to the caller's visible stores (the same
// drill-down the hub Team view shows), so leadership gets the Week Trend popup
// without minting a share link.
async function laborFileWeek(supa, user, params) {
  if (!TEAM_ROLES.has(roleOf(user))) return { error: "not authorized", status: 403 };
  const visible = await resolveVisibleStoreRows(supa, user);
  let numbers = [...new Set(visible.map((s) => String(s.number)))];
  if (!numbers.length) return { level: params.level || "region", dates: [], week_start: null, has_prev: false, has_next: false, scope_total: null, nodes: [] };
  const nameByNumber = new Map(visible.map((s) => [String(s.number), s.name]));
  const orgMap = await resolveOrg(supa, numbers);
  numbers = numbers.filter((n) => orgMap.get(n)?.region && !CORPORATE_STORE_NUMBERS.has(n));
  return weekTrendCore(supa, numbers, orgMap, nameByNumber, params, "All my stores");
}

// Admin/VP: list existing links + the region list to mint against.
async function listLaborShares(supa, user) {
  if (!LABOR_SHARE_ROLES.has(roleOf(user))) return { error: "forbidden", status: 403 };
  const [{ data: shares }, { data: regions }] = await Promise.all([
    supa.from("labor_share_tokens").select("id, token, scope_kind, region_id, label, created_at, last_used_at").eq("is_active", true).order("created_at"),
    supa.from("regions").select("id, name").order("name"),
  ]);
  const rn = new Map((regions || []).map((r) => [r.id, r.name]));
  return {
    shares: (shares || []).map((s) => ({ ...s, region_name: s.region_id ? (rn.get(s.region_id) ?? null) : null })),
    regions: (regions || []).map((r) => ({ id: r.id, name: r.name })),
  };
}

async function mintLaborShare(supa, user, body) {
  if (!LABOR_SHARE_ROLES.has(roleOf(user))) return { error: "forbidden", status: 403 };
  const regionId = body?.region_id || null;
  const scopeKind = regionId ? "region" : "company";
  const label = (body?.label || "").trim() || null;
  const base = supa.from("labor_share_tokens").select("id, token").eq("is_active", true);
  const { data: existing } = regionId ? await base.eq("region_id", regionId).maybeSingle() : await base.is("region_id", null).maybeSingle();
  if (existing) return { token: existing.token, id: existing.id, reused: true };
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
  const { data, error } = await supa.from("labor_share_tokens")
    .insert({ token, scope_kind: scopeKind, region_id: regionId, label, created_by: user.id })
    .select("id, token").single();
  if (error) return { error: error.message, status: 500 };
  return { token: data.token, id: data.id, reused: false };
}

async function revokeLaborShare(supa, user, body) {
  if (!LABOR_SHARE_ROLES.has(roleOf(user))) return { error: "forbidden", status: 403 };
  const id = body?.id;
  if (!id) return { error: "id required", status: 400 };
  const { error } = await supa.from("labor_share_tokens").update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); }
  catch (e) { return respond(500, { error: e.message }); }

  // PUBLIC labor share endpoints — handled before the auth gate; token is credential.
  const preParams = event.queryStringParameters || {};
  if (event.httpMethod === "GET" && (preParams.action === "shared-labor" || preParams.action === "shared-labor-store" || preParams.action === "shared-labor-week")) {
    try {
      const out = preParams.action === "shared-labor-store"
        ? await sharedLaborStore(supa, preParams.token, preParams.store)
        : preParams.action === "shared-labor-week"
          ? await sharedLaborWeek(supa, preParams.token, preParams)
          : await sharedLabor(supa, preParams.token);
      return out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out });
    } catch (e) {
      return respond(500, { error: e.message || "server error" });
    }
  }
  if (event.httpMethod === "POST" && preParams.action === "shared-labor-store-review") {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const out = await sharedLaborStoreReview(supa, preParams.token || body.token, body);
      return out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out });
    } catch (e) {
      return respond(500, { error: e.message || "server error" });
    }
  }

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
      if (action === "set-labor-settings") {
        if (!isAdmin) return respond(403, { error: "Admins only." });
        await setLaborHrsWeekly(supa, body.hrs_weekly_rate, user.id);
        return respond(200, { ok: true, hrs_weekly_rate: !!body.hrs_weekly_rate });
      }
      if (action === "no-gm-add") return unwrap(await noGmAdd(supa, user, body));
      if (action === "no-gm-end") return unwrap(await noGmEnd(supa, user, body));
      if (action === "no-gm-update") return unwrap(await noGmUpdate(supa, user, body));
      if (action === "no-gm-delete") return unwrap(await noGmDelete(supa, user, body));
      if (action === "no-gm-rate-set") return unwrap(await noGmRateSet(supa, user, body));
      if (action === "gm-support-add") return unwrap(await gmSupportAdd(supa, user, body));
      if (action === "gm-support-update") return unwrap(await gmSupportUpdate(supa, user, body));
      if (action === "gm-support-end") return unwrap(await gmSupportEnd(supa, user, body));
      if (action === "gm-support-delete") return unwrap(await gmSupportDelete(supa, user, body));
      if (action === "rvp-commitment-set") return unwrap(await rvpCommitmentSet(supa, user, body));
      if (action === "rvp-commitment-delete") return unwrap(await rvpCommitmentDelete(supa, user, body));
      if (action === "rvp-commitment-buckets-set") return unwrap(await rvpCommitmentBucketsSet(supa, user, body));
      if (action === "rvp-commitment-base-set") return unwrap(await rvpCommitmentBaseSet(supa, user, body));
      if (action === "labor-share-mint") return unwrap(await mintLaborShare(supa, user, body));
      if (action === "labor-share-revoke") return unwrap(await revokeLaborShare(supa, user, body));
      if (action === "corp-training-parse") return unwrap(await corpTrainingParse(supa, user, body));
      if (action === "corp-training-apply") return unwrap(await corpTrainingApply(supa, user, body));
      if (action === "corp-training-delete") return unwrap(await corpTrainingDelete(supa, user, body));
      if (action === "corp-training-rate-set") return unwrap(await corpTrainingRateSet(supa, user, body));
      return respond(400, { error: `Unknown action: ${action}` });
    }

    // GM-facing reads — scope enforced per store in the function.
    if (action === "gm") return unwrap(await gmView(supa, user, params));
    if (action === "team") return unwrap(await teamView(supa, user, params));
    if (action === "labor-settings") return respond(200, { ok: true, hrs_weekly_rate: await getLaborHrsWeekly(supa) });
    if (action === "labor-file") return unwrap(await laborFile(supa, user));
    if (action === "labor-file-week") return unwrap(await laborFileWeek(supa, user, params));
    if (action === "rvp-scorecard") return unwrap(await rvpScorecard(supa, user, params));
    if (action === "rvp-commitments") return unwrap(await rvpCommitments(supa, user));
    if (action === "miss-tracker") return unwrap(await missTracker(supa, user, params));
    if (action === "my-stores") return unwrap(await listMyStores(supa, user));
    if (action === "no-gm-list") return unwrap(await noGmList(supa, user));
    if (action === "corp-training-list") return unwrap(await corpTrainingList(supa, user));
    if (action === "gm-support-list") return unwrap(await gmSupportList(supa, user));
    if (action === "labor-shares") return unwrap(await listLaborShares(supa, user));

    // Admin-only org rollup.
    if (!isAdmin) return respond(403, { error: "Admins only." });
    if (action === "dates") return respond(200, await listDates(supa));
    if (action === "pull-log") return respond(200, { ok: true, ...(await pullLog(supa)) });
    if (action === "data-revisions") return unwrap(await dataRevisions(supa, params));
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
