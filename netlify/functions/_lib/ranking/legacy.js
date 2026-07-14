// Legacy ranker history: import the SOAR metrics sheet's week tabs into
// ranking_legacy_weeks (permanent archive - the sheet dies at cutover, the
// history must not), and serve the merged sheet-era + hub-era trend series.

import {
  getSheetsClient, getAvailableWeeks, batchGetWeeks,
  buildStoreMetricObject, getStoreDigits, parseNum,
  FIXED_COL, METRIC_KEYS,
} from "../ranker-sheets.js";
import { fiscalForDate } from "../fiscal.js";

const FY_START = "2025-12-29"; // FY2026 week 1 starts here (matches _lib/fiscal.js)
const TEXT_KEYS = new Set(["storeNum", "storeName", "gmName"]);

function addDaysIso(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const weekEndingOf = (fiscalWeek) => addDaysIso(FY_START, fiscalWeek * 7 - 1);
const isNum = (v) => typeof v === "number" && isFinite(v);

// ── Import (idempotent, resumable, newest weeks first) ────────────────
export async function importLegacyWeeks(supa, { budgetMs = 7000 } = {}) {
  const started = Date.now();
  let sheets;
  try { sheets = await getSheetsClient(); }
  catch (e) { return { error: `Sheets access failed: ${e.message}`, status: 500 }; }
  let available;
  try { available = await getAvailableWeeks(sheets); }
  catch (e) { return { error: `Couldn't list the sheet's week tabs: ${e.message}`, status: 500 }; }
  if (!available.length) return { error: "The metrics sheet has no week tabs.", status: 400 };

  const imported = [];
  const remaining = [];
  let skipped = 0;
  for (const w of [...available].sort((a, b) => b - a)) {
    if (Date.now() - started > budgetMs) { remaining.push(w); continue; }
    const { data: probe, error: probeErr } = await supa
      .from("ranking_legacy_weeks").select("store_number").eq("fiscal_week", w).limit(1);
    if (probeErr) {
      if (/ranking_legacy_weeks/.test(probeErr.message)) return { error: "Run migration 0241 first.", status: 500 };
      return { error: probeErr.message, status: 500 };
    }
    if (probe?.length) { skipped++; continue; }

    const weekData = (await batchGetWeeks(sheets, [String(w)])).get(String(w));
    const rows = (weekData?.rows || []).map((row) => {
      const raw = buildStoreMetricObject(row, weekData.idx);
      const metrics = {};
      for (const k of METRIC_KEYS) {
        if (TEXT_KEYS.has(k)) continue;
        metrics[k] = parseNum(raw[k]);
      }
      return {
        fiscal_week: w,
        week_ending: weekEndingOf(w),
        store_number: getStoreDigits(row[FIXED_COL.storeNum]),
        store_name: String(row[FIXED_COL.storeName] ?? "").trim() || null,
        gm_name: String(row[FIXED_COL.gmName] ?? "").trim() || null,
        metrics,
      };
    }).filter((r) => r.store_number);
    if (!rows.length) { imported.push({ week: w, rows: 0 }); continue; }
    for (let i = 0; i < rows.length; i += 300) {
      const { error } = await supa.from("ranking_legacy_weeks")
        .upsert(rows.slice(i, i + 300), { onConflict: "fiscal_week,store_number" });
      if (error) return { error: error.message, status: 500 };
    }
    imported.push({ week: w, rows: rows.length });
  }
  return { available: available.length, imported, skipped, remaining };
}

// ── Merged trend series (sheet era + hub era) ────────────────────────
// One axis of fiscal weeks; hub runs win a week when both eras have it.
// All rates normalized to PERCENT POINTS (the sheet's unit); hub fractions
// are multiplied up so a single line means one thing across the seam.
export async function trendsData(supa, params) {
  const weeksBack = Math.max(4, Math.min(53, Number(params.weeks) || 26));

  // Hub runs, newest first, one per week_ending.
  const { data: runs } = await supa
    .from("ranking_runs")
    .select("id, week_ending, started_at")
    .eq("status", "complete")
    .order("week_ending", { ascending: false })
    .order("started_at", { ascending: false })
    .limit(80);
  const hubByWeek = new Map(); // fiscal_week -> { runId, week_ending }
  for (const r of runs || []) {
    const fi = fiscalForDate(r.week_ending);
    if (fi && !hubByWeek.has(fi.fiscalWeek)) hubByWeek.set(fi.fiscalWeek, { runId: r.id, week_ending: r.week_ending });
  }

  // Legacy weeks present.
  const { data: maxRow, error: maxErr } = await supa
    .from("ranking_legacy_weeks").select("fiscal_week")
    .order("fiscal_week", { ascending: false }).limit(1);
  if (maxErr && !/ranking_legacy_weeks/.test(maxErr.message)) return { error: maxErr.message, status: 500 };
  const legacyMax = maxRow?.[0]?.fiscal_week ?? null;

  const allWeeks = new Set([...hubByWeek.keys()]);
  if (legacyMax != null) {
    for (let w = legacyMax; w > Math.max(0, legacyMax - weeksBack); w--) allWeeks.add(w);
  }
  const axis = [...allWeeks].sort((a, b) => a - b).slice(-weeksBack);
  if (!axis.length) return { weeks: [], stores: {} };

  const weeks = [];
  const stores = {}; // number -> { name, gm, series arrays }
  const SERIES = ["rank", "labor", "vsly", "cogs", "ontime", "sales"];
  const ensure = (num, name, gm) => {
    if (!stores[num]) {
      stores[num] = { name: name ?? null, gm: gm ?? null };
      for (const s of SERIES) stores[num][s] = new Array(axis.length).fill(null);
    } else {
      if (name && !stores[num].name) stores[num].name = name;
      if (gm && !stores[num].gm) stores[num].gm = gm;
    }
    return stores[num];
  };

  for (let i = 0; i < axis.length; i++) {
    const w = axis[i];
    const hub = hubByWeek.get(w);
    const weekEnding = hub?.week_ending ?? weekEndingOf(w);
    const fi = fiscalForDate(weekEnding);
    weeks.push({
      fiscal_week: w,
      week_ending: weekEnding,
      label: fi ? `P${fi.period}W${fi.weekInPeriod}` : `W${w}`,
      source: hub ? "hub" : "sheet",
    });

    if (hub) {
      const { data: rows } = await supa
        .from("ranking_rows")
        .select("entity_key, rank, metrics")
        .eq("run_id", hub.runId).eq("scope", "ptd").eq("tier", "store")
        .limit(1500);
      for (const r of rows || []) {
        const m = r.metrics || {};
        const st = ensure(String(r.entity_key), m.location, m.gm);
        st.rank[i] = isNum(r.rank) ? r.rank : null;
        st.labor[i] = isNum(m.laborPct) ? m.laborPct * 100 : null;
        st.vsly[i] = isNum(m.pctVsLy) ? m.pctVsLy * 100 : null;
        st.cogs[i] = isNum(m.cogsEff) ? m.cogsEff * 100 : null;
        st.ontime[i] = isNum(m.onTimePct) ? m.onTimePct * 100 : null;
        st.sales[i] = isNum(m.sales) ? m.sales : null;
      }
    } else {
      const { data: rows } = await supa
        .from("ranking_legacy_weeks")
        .select("store_number, store_name, gm_name, metrics")
        .eq("fiscal_week", w)
        .limit(1500);
      for (const r of rows || []) {
        const m = r.metrics || {};
        const st = ensure(String(r.store_number), r.store_name, r.gm_name);
        st.rank[i] = isNum(m.storeRank) ? m.storeRank : null;
        st.labor[i] = isNum(m.laborPct) ? m.laborPct : null;
        st.vsly[i] = isNum(m.vsLastYear) ? m.vsLastYear : null;
        st.cogs[i] = isNum(m.cogsEff) ? m.cogsEff : null;
        st.ontime[i] = isNum(m.onTimeTickets) ? m.onTimeTickets : null;
        st.sales[i] = isNum(m.weeklySales) ? m.weeklySales : null;
      }
    }
  }
  // Scope to the caller's stores (a Set of numbers); null/absent = org-wide.
  if (params.storeNums instanceof Set) {
    for (const num of Object.keys(stores)) if (!params.storeNums.has(num)) delete stores[num];
  }
  return { weeks, stores };
}

// ── Unified week timeline + legacy-week store rows ───────────────────
// The sheet stores rates as PERCENT POINTS (e.g. laborPct 18.89); the new
// engine uses fractions (0.1889). Map sheet metrics into the new-engine shape
// so the board + store popup render a legacy week the same way as a hub week.
function mapLegacyMetrics(lm, storeName, gm) {
  const n = (v) => (isNum(v) ? v : null);
  const pct = (v) => (isNum(v) ? v / 100 : null); // percent points -> fraction
  return {
    location: storeName ?? null,
    gm: gm ?? null,
    sales: n(lm.weeklySales),
    pctVsLy: pct(lm.vsLastYear),
    cogsEff: pct(lm.cogsEff),
    fcAnnualized: n(lm.annualizedFcMiss),
    finAnnualized: n(lm.annualizedFinancialMiss),
    laborPct: pct(lm.laborPct),
    varianceToChart: pct(lm.varToChart),
    bscTrainingPct: pct(lm.bscTraining),
    onTimePct: pct(lm.onTimeTickets),
    vog: pct(lm.vogWeek),
    vogResponses: n(lm.vogCount),
    complaints: n(lm.complaints),
    callsPer10k: n(lm.callsPer10k),
  };
}

// The merged week picker: hub runs (newest per week) + the sheet-era legacy
// weeks that fall BEFORE the cutover (the earliest hub run — i.e. P7W2). Newest
// first. `legacyImported` tells the UI whether the archive has been populated.
export async function unifiedWeeks(supa) {
  const [{ data: runs }, { data: legacy }] = await Promise.all([
    supa.from("ranking_runs").select("id, week_ending, period, week, started_at")
      .eq("status", "complete").order("week_ending", { ascending: false }).order("started_at", { ascending: false }).limit(200),
    supa.from("ranking_legacy_weeks").select("fiscal_week").limit(5000),
  ]);
  const seen = new Set();
  const hub = [];
  for (const r of runs || []) {
    if (seen.has(r.week_ending)) continue;
    seen.add(r.week_ending);
    const fi = fiscalForDate(r.week_ending);
    hub.push({ key: r.id, source: "hub", run_id: r.id, fiscal_week: fi?.fiscalWeek ?? null, period: r.period, week: r.week, week_ending: r.week_ending });
  }
  const cutover = hub.length ? Math.min(...hub.map((h) => (isNum(h.fiscal_week) ? h.fiscal_week : Infinity))) : Infinity;
  const legacyWeeks = [...new Set((legacy || []).map((r) => Number(r.fiscal_week)).filter(Number.isFinite))]
    .filter((w) => w < cutover)
    .map((w) => {
      const we = weekEndingOf(w);
      const fi = fiscalForDate(we);
      return { key: `legacy-${w}`, source: "legacy", run_id: null, fiscal_week: w, period: fi?.period ?? null, week: fi?.weekInPeriod ?? null, week_ending: we };
    });
  const weeks = [...hub, ...legacyWeeks].sort((a, b) => (b.fiscal_week ?? 0) - (a.fiscal_week ?? 0));
  return { weeks, legacyImported: (legacy || []).length > 0 };
}

// One legacy (sheet-era) week's store rows, mapped to the new-engine shape and
// scoped to the caller. Store tier only — the sheet archive has no leader
// aggregates.
export async function legacyWeekStores(supa, params, storeNums = null) {
  const w = Number(params.fiscal_week);
  if (!Number.isFinite(w)) return { error: "Bad fiscal_week.", status: 400 };
  const { data, error } = await supa
    .from("ranking_legacy_weeks")
    .select("store_number, store_name, gm_name, metrics")
    .eq("fiscal_week", w).limit(2000);
  if (error) {
    if (/ranking_legacy_weeks/.test(error.message)) return { error: "Run migration 0241 first (legacy archive missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  let rows = (data || []).map((r) => {
    const lm = r.metrics || {};
    return {
      entity_key: String(r.store_number),
      store_id: null,
      rank: isNum(lm.storeRank) ? lm.storeRank : null,
      total_points: null,
      metrics: mapLegacyMetrics(lm, r.store_name, r.gm_name),
    };
  });
  if (storeNums != null) rows = rows.filter((r) => storeNums.has(String(r.entity_key)));
  rows.sort((a, b) => (isNum(a.rank) ? a.rank : 9999) - (isNum(b.rank) ? b.rank : 9999));
  const weekEnding = weekEndingOf(w);
  const fi = fiscalForDate(weekEnding);
  const run = { id: `legacy-${w}`, source: "legacy", week_ending: weekEnding, period: fi?.period ?? null, week: fi?.weekInPeriod ?? null, completed_at: null, config_version: "sheet" };
  return { run, scope: "ptd", tier: "store", rows };
}
