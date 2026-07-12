// Smoke test for the ported ranking engine (netlify/functions/_lib/ranking/engine.cjs).
// NOT the Phase 0 validation gate — that runs against the sheet's snapshot CSVs once
// they arrive. This proves the byte-for-byte CJS port loads under Node ESM and that
// the primitives + tier assembly behave on hand-checkable synthetic inputs.
//
// Run: node test/ranking/smoke.mjs

import assert from "node:assert/strict";
import engine from "../../netlify/functions/_lib/ranking/engine.cjs";

const { runRanking, bandScore, laborChartRow, rankDesc, laborScoreHoursOver, laborScoreChart } = engine;

// ── primitives ────────────────────────────────────────────────────────
const SALES_BAND = [[-1, 1], [-0.02, 2], [0, 3], [0.02, 4], [0.05, 5]];

assert.equal(bandScore(0.03, SALES_BAND), 4, "HLOOKUP approx: 0.03 -> 4");
assert.equal(bandScore(0.05, SALES_BAND), 5, "boundary hits the higher band");
assert.equal(bandScore(-5, SALES_BAND, 3), 3, "below first threshold -> IFERROR default");
assert.equal(bandScore("NO LY", SALES_BAND, 3), 3, "text value -> default");
assert.equal(bandScore("NO LY", SALES_BAND, undefined), null, "no IFERROR -> null");

assert.equal(laborScoreHoursOver(0), 5);
assert.equal(laborScoreHoursOver(0.5), 4);
assert.equal(laborScoreHoursOver(1.5), 3);
assert.equal(laborScoreHoursOver(4.9), 2);
assert.equal(laborScoreHoursOver(7), 1);
assert.equal(laborScoreHoursOver(null), null);

assert.equal(laborScoreChart(0.20, 0.24, 0.22), 5, "below chart2 -> 5");
assert.equal(laborScoreChart(0.23, 0.24, 0.22), 4, "below chart1 -> 4");
assert.equal(laborScoreChart(0.2405, 0.24, 0.22), 3, "within +0.001 -> 3");
assert.equal(laborScoreChart(0.244, 0.24, 0.22), 2, "within +0.005 -> 2");
assert.equal(laborScoreChart(0.30, 0.24, 0.22), 1);

assert.deepEqual(rankDesc([10, 12, null, 10]), [2, 1, null, 2], "RANK.EQ desc with tie + null");

const CHART = [
  { min4: 0, chart1: 0.26, chart2: 0.24 },
  { min4: 400000, chart1: 0.24, chart2: 0.22 },
  { min4: 800000, chart1: 0.22, chart2: 0.20 },
];
assert.equal(laborChartRow(500000, CHART).chart1, 0.24, "VLOOKUP approx row 2");
assert.equal(laborChartRow(-1, CHART), null, "below min4 -> null");

// ── end-to-end tier assembly ─────────────────────────────────────────
const cfg = {
  bands: {
    sales_vs_ly: SALES_BAND,
    food_cost: [[0.90, 1], [0.94, 2], [0.96, 3], [0.98, 4], [1.0, 5]],
    bsc_training: [[0, 1], [0.5, 2], [0.7, 3], [0.85, 4], [0.95, 5]],
    on_time: [[0, 1], [0.7, 2], [0.8, 3], [0.9, 4], [0.95, 5]],
    complaints: [[0, 5], [1, 4], [2, 3], [5, 2], [10, 1]],
    food_safety: [[0, 1], [0.8, 2], [0.85, 3], [0.9, 4], [0.95, 5]],
    vog: [[0, 1], [0.6, 2], [0.7, 3], [0.8, 4], [0.9, 5]],
    total_training: [[0, 1], [0.5, 2], [0.7, 3], [0.85, 4], [0.95, 5]],
  },
  laborChart: CHART,
  avgWage: 12.84,
  period: 7,
  week: 1,
  weeksInPeriod: 4,
  weekEnding: "2026-07-05",
};

function mkStore(n, doName, sdoName, rvpName, entity, ptd) {
  const base = {
    sales: 100000, lySales: 90000, tickets: 9000, lyTickets: 8500,
    cogsEff: 0.97, fcMiss: 500, laborPct: 0.25,
    trainingCreditDollars: 0, ptoDollars: 0,
    bscTrainingPct: 0.9, onTimePct: 0.92, callsPer10k: 0.8, custCount: 9000,
    ecosure: 0.93, vogScore: 0.85, vogResponses: 40, totalTrainingPct: 0.8,
    msCount: 1, msScore: 0.9, voids: 200, doh: 6, dohGoal: 5,
    endingDollars: 9000, dollarsOverGoal: 100,
  };
  const p = { ...base, ...ptd };
  return {
    store: n, location: `Loc ${n}`, gm: `GM ${n}`,
    doName, sdoName, rvpName, entity,
    tenureSoar: 2, tenureLoc: 1, laborPad: null,
    ptd: p, wtd: { ...p },
  };
}

const stores = [
  mkStore("1001", "do:A", "sdo:X", "rvp:R", "LLC One", {}),
  mkStore("1002", "do:A", "sdo:X", "rvp:R", "LLC One", { lySales: null }), // NO LY store
  mkStore("1003", "do:B", "sdo:X", "rvp:R", "LLC Two", { sales: 200000, laborPct: 0.30 }),
];

const out = runRanking({ config: cfg, stores, leaderTrainingCredit: { "SOAR QSR": 0 }, leaders: {}, rollups: {} });

// Shape
assert.equal(out.ptd.stores.length, 3);
assert.equal(out.ptd.dos.length, 2, "two DOs");
assert.equal(out.ptd.sdos.length, 1);
assert.equal(out.ptd.rvps.length, 1);
assert.equal(out.ptd.entities.length, 2, "two entities (PTD only)");
assert.deepEqual(out.wtd.entities, [], "no WTD entity block");
assert.equal(out.ptd.company.tier, "company");
assert.equal(out.ptd.company.storeCount, 3);

// Store 1001 hand-checks (PTD)
const s1 = out.ptd.stores[0];
assert.ok(Math.abs(s1.pctVsLy - (10000 / 90000)) < 1e-12, "pctVsLy = 11.1%");
assert.equal(s1.salesScore, 5, "11% vs LY -> 5");
assert.equal(s1.fcScore, 3, "0.97 eff -> band 0.96 -> 3 (HLOOKUP approx)");
// volume = (100000/(1*7))*4*7 = 400000 -> chart row 2 (0.24); variance = 0.25-0.24-0-0-0 = 0.01
assert.ok(Math.abs(s1.varianceToChart - 0.01) < 1e-12, "variance to chart");
assert.ok(Math.abs(s1.laborMiss - 1000) < 1e-9, "labor miss $1000");
assert.ok(Math.abs(s1.hoursOver - 1000 / 12.84) < 1e-9, "hours over");
assert.equal(s1.laborScore, 1, "77.9 hrs over -> 1");

// NO LY behavior
const s2 = out.ptd.stores[1];
assert.equal(s2.pctVsLy, "NO LY");
assert.equal(s2.salesScore, 3, "NO LY -> 3");

// DO A rollup: lySales gets NO-LY member's current sales added
const doA = out.ptd.dos.find((d) => d.name === "do:A");
assert.equal(doA.storeCount, 2);
assert.equal(doA.lySales, 90000 + 100000, "NO-LY store's current sales added to LY base");

// Entity tier: plain SUMIF, NO NO-LY addition
const llc1 = out.ptd.entities.find((e) => e.name === "LLC One");
assert.equal(llc1.lySales, 90000, "entity tier: no NO-LY addition");

// Ranks assigned within each block — 1001 and 1003 tie on total points, so
// RANK.EQ gives [1, 1, 3] (no rank 2), exactly like Excel.
assert.deepEqual(
  [...out.ptd.stores].map((s) => s.rank).sort(),
  [1, 1, 3], "RANK.EQ tie semantics");
assert.equal(out.ptd.company.rank, null, "company row unranked");

// Engine treats leader keys as opaque strings (brief 4.2)
assert.ok(out.ptd.dos.every((d) => d.name.startsWith("do:")), "opaque UUID-style keys flow through");

// ── per-store chart input (brief 4.3 / B1: IX target replaces the lookup) ──
const ixStore = mkStore("2001", "do:C", "sdo:Y", "rvp:R", "LLC Three", {
  chart1: 0.20, chart2: 0.20, laborPct: 0.21,
  trainingCreditDollars: 0, ptoDollars: 0,
});
ixStore.wtd.chart1 = 0.20; ixStore.wtd.chart2 = 0.20;
const ixOut = runRanking({ config: { ...cfg, laborChart: [] }, stores: [ixStore], leaderTrainingCredit: {}, leaders: {}, rollups: {} });
const ixRow = ixOut.ptd.stores[0];
assert.ok(Math.abs(ixRow.varianceToChart - 0.01) < 1e-12, "per-store chart1 wins over empty lookup (PTD)");
assert.ok(Math.abs(ixRow.chart - 0.20) < 1e-12, "chart column = IX target");
const ixWtd = ixOut.wtd.stores[0];
assert.ok(Math.abs(ixWtd.chart - 0.20) < 1e-12, "per-store chart1 wins (WTD)");
assert.equal(ixWtd.laborScore, 1, "WTD 21% vs 20% chart (chart2=chart1 interim) -> 1");

// ── config resolution + the REAL seeded bands (migration 0239) ───────
const { resolveConfigSlice } = await import("../../netlify/functions/_lib/ranking/config.js");

const cfgRows = [
  { key: "avg_wage", value: { amount: 12.84 }, effective_from: "2025-12-29" },
  { key: "avg_wage", value: { amount: 14.0 }, effective_from: "2026-09-01" }, // future change
  { key: "bands.vog", value: [[0, 1], [0.4, 2]], effective_from: "2025-12-29" },
];
const slice = resolveConfigSlice(cfgRows, "2026-07-05");
assert.equal(slice.values["avg_wage"].amount, 12.84, "future-dated config row ignored");
assert.equal(slice.version, "2025-12-29", "version = max effective_from used");
const later = resolveConfigSlice(cfgRows, "2026-09-15");
assert.equal(later.values["avg_wage"].amount, 14.0, "dated change takes over on/after its date");

// Real Config-tab bands (seeded by 0239) behave as the sheet intends:
const REAL = {
  sales_vs_ly: [[-6.6, 1], [-0.1, 2], [0, 3], [0.1, 4], [0.2, 5]],
  food_cost: [[0, 1], [0.92, 2], [0.96, 3], [0.97, 4], [0.985, 5]],
  on_time: [[0, 1], [0.6501, 2], [0.7001, 3], [0.7501, 4], [0.8001, 5]],
  complaints: [[0, 5], [1.3001, 4], [1.701, 3], [2.001, 2], [2.5, 1]],
  food_safety: [[0, 1], [0.84, 2], [0.88, 3], [0.92, 4], [0.950001, 5]],
  vog: [[0, 1], [0.4, 2], [0.5, 3], [0.6, 4], [0.7, 5]],
};
assert.equal(bandScore(0.97, REAL.food_cost), 4, "97% FC eff -> 4");
assert.equal(bandScore(-0.05, REAL.sales_vs_ly), 2, "-5% vs LY -> 2");
assert.equal(bandScore(0.15, REAL.sales_vs_ly), 4, "+15% vs LY -> 4");
assert.equal(bandScore(0.80, REAL.on_time), 4, "80% on-time -> 4");
assert.equal(bandScore(0.5, REAL.complaints), 5, "0.5 calls/10k -> 5 (lower is better)");
assert.equal(bandScore(2.2, REAL.complaints), 2, "2.2 calls/10k -> 2");
assert.equal(bandScore(3.0, REAL.complaints), 1, "3.0 calls/10k -> 1 (past 2.5)");
assert.equal(bandScore(0.95, REAL.food_safety), 4, "95.0% EcoSure -> 4 (5 needs > 0.950001)");
assert.equal(bandScore(0.65, REAL.vog), 4, "65% VOG -> 4");

console.log("ranking engine smoke: ALL PASS");
