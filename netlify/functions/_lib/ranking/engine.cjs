'use strict';
/*
 * Engine.js — SOAR ranking calculation engine (pure JS, no Apps Script / Node APIs).
 * Implements the workbook math per SPEC_main_sheets.md §1 (PTD) / §2 (WTD) with the
 * documented deviations from DESIGN.md:
 *   - FC efficiency >= 1.01 -> score 5 at ALL tiers (workbook DO tier gave 1).
 *   - No Chart 2 output column (chart2 still computed internally for WTD/entity labor scores).
 *   - Dynamic store counts everywhere (workbook hard-coded 190/271).
 *   - WEEKLY company DOH "reads the PTD sheet" quirk dropped (uses WTD rollup/average).
 *   - NEW ticketsVsLy fields (tickets, lyTickets, ticketsVsLyPct) at every tier.
 *
 * Entry point: runRanking(inputs) -> { ptd: TierSet, wtd: TierSet, issues: Issue[] }
 *   TierSet = { stores, dos, sdos, rvps, company, entities }  (wtd.entities = [] — no WTD entity block)
 *
 * inputs = {
 *   config: { bands, laborChart, avgWage, period, week, weeksInPeriod, weekEnding },
 *   stores: [ { store, location, gm, doName, sdoName, rvpName, entity, tenureSoar, tenureLoc,
 *               laborPad, ptd: {...}, wtd: {...} } ],
 *   leaderTrainingCredit: { [leaderNameOrCompanyKey]: dollars },   // optional; 'SOAR QSR' = company
 *   leaders: { [name]: {tenureSoar, tenureLoc} },                  // optional
 *   rollups: { do: {name: {cogsEff, doh, dohGoal}}, sdo:..., rvp:..., company: {...},   // optional,
 *              wtdDo:..., wtdSdo:..., wtdRvp:..., wtdCompany: {...} }                   // measured IX rollups
 * }
 * Numbers may be null; the engine reproduces workbook text fallbacks ('NO LY', '-', 'No Audit', 'NEW DO'...).
 */

// ============================== primitives ==============================

function isNum(v) { return typeof v === 'number' && isFinite(v); }

// Excel HLOOKUP(value, band, 2) approximate-match: largest threshold <= value.
// Non-numeric value or value below first threshold -> #N/A -> returns `dflt`
// (pass undefined for "no IFERROR" -> null).
function bandScore(value, band, dflt) {
  var fallback = (dflt === undefined) ? null : dflt;
  if (!isNum(value)) return fallback;
  var score = null;
  for (var i = 0; i < band.length; i++) {
    if (value >= band[i][0]) score = band[i][1];
    else break;
  }
  return (score === null) ? fallback : score;
}

// Excel VLOOKUP(volume, chart, col, TRUE) on min4 ascending. Returns {chart1, chart2} row or null.
function laborChartRow(volume, chart) {
  if (!isNum(volume)) return null;
  var row = null;
  for (var i = 0; i < chart.length; i++) {
    if (volume >= chart[i].min4) row = chart[i];
    else break;
  }
  return row;
}

// Excel RANK.EQ descending: 1 + count of strictly greater numeric values. Non-numeric -> null.
function rankDesc(values) {
  return values.map(function (v) {
    if (!isNum(v)) return null;
    var r = 1;
    for (var i = 0; i < values.length; i++) {
      if (isNum(values[i]) && values[i] > v) r++;
    }
    return r;
  });
}

// Excel ROUND(x, 0): half away from zero.
function excelRound0(x) {
  if (!isNum(x)) return null;
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

// Excel SUM over possibly-null values (blank -> 0). If `strict`, any null propagates null
// (models error propagation for score sums where a component is #N/A).
function sumScores(parts) {
  var s = 0;
  for (var i = 0; i < parts.length; i++) {
    if (!isNum(parts[i])) return null; // Excel SUM(#N/A,...) -> #N/A
    s += parts[i];
  }
  return s;
}

// Tenure display rule: IF(IFERROR(v,"-")>50,"-",IFERROR(v,"-"))
function tenureDisplay(v) {
  if (!isNum(v)) return '-';
  return v > 50 ? '-' : v;
}

// SUMIF-style sum over member rows (nulls/text skipped like Excel SUMIF skips text; see FINDINGS).
function sumBy(rows, sel) {
  var s = 0;
  for (var i = 0; i < rows.length; i++) {
    var v = sel(rows[i]);
    if (isNum(v)) s += v;
  }
  return s;
}

// SUMIF with Excel ERROR PROPAGATION: a null member value means the workbook cell was an
// error (#N/A / #DIV/0!), and Excel SUMIF/SUM propagate member errors. Used for voids and
// $-over-goal, whose store formulas either compute or error (never blank).
function sumPropagate(rows, sel) {
  var s = 0;
  for (var i = 0; i < rows.length; i++) {
    var v = sel(rows[i]);
    if (!isNum(v)) return null;
    s += v;
  }
  return s;
}

// AVERAGEIF-style average of numeric member values; returns null when none numeric (#DIV/0!).
function avgBy(rows, sel) {
  var s = 0, n = 0;
  for (var i = 0; i < rows.length; i++) {
    var v = sel(rows[i]);
    if (isNum(v)) { s += v; n++; }
  }
  return n ? s / n : null;
}

// SUMPRODUCT(IF(member,1,0), weightCol, valueCol) / divisor — sales-weighted average.
// Blank (null) values behave like Excel blanks (0). Text would be #VALUE! in Excel; we treat as 0
// and record an issue upstream.
function weightedBy(rows, weightSel, valSel, divisor) {
  if (!isNum(divisor) || divisor === 0) return null;
  var s = 0;
  for (var i = 0; i < rows.length; i++) {
    var w = weightSel(rows[i]);
    var v = valSel(rows[i]);
    s += (isNum(w) ? w : 0) * (isNum(v) ? v : 0);
  }
  return s / divisor;
}

// ============================== store rows ==============================

// PTD store row per SPEC §1.2 (column letters in comments refer to 'SOAR ALL RANKING PTD').
function computeStorePtd(st, cfg, issues) {
  var p = st.ptd || {};
  var r = {
    tier: 'store',
    store: st.store,
    location: st.location != null ? st.location : null,
    gm: st.gm != null ? st.gm : null,
    tenureSoar: tenureDisplay(st.tenureSoar), // J
    tenureLoc: tenureDisplay(st.tenureLoc),   // K
    doName: st.doName, sdoName: st.sdoName, rvpName: st.rvpName, entity: st.entity,
  };

  // --- Sales (N/O/P/Q) ---
  r.sales = isNum(p.sales) ? p.sales : null;
  r.lySales = isNum(p.lySales) ? p.lySales : null;
  // P = IFERROR((N-LY)/LY, "NO LY")  (missing LY lookup or LY=0 -> "NO LY")
  r.pctVsLy = (isNum(r.sales) && isNum(r.lySales) && r.lySales !== 0)
    ? (r.sales - r.lySales) / r.lySales : 'NO LY';
  r.salesScore = bandScore(r.pctVsLy, cfg.bands.sales_vs_ly, 3); // Q: IFERROR(...,3)

  // --- NEW: tickets vs LY ---
  r.tickets = isNum(p.tickets) ? p.tickets : null;
  r.lyTickets = isNum(p.lyTickets) ? p.lyTickets : null;
  r.ticketsVsLyPct = (isNum(r.tickets) && isNum(r.lyTickets) && r.lyTickets !== 0)
    ? (r.tickets - r.lyTickets) / r.lyTickets : 'NO LY';

  // --- Food cost (S/T/U/V) ---
  r.cogsEff = isNum(p.cogsEff) ? p.cogsEff : null;
  // T = IF(S>1, 0, rawMiss); missing IX -> S is #N/A -> T #N/A -> null
  if (r.cogsEff === null) r.fcMiss = null;
  else if (r.cogsEff > 1) r.fcMiss = 0;
  else r.fcMiss = isNum(p.fcMiss) ? p.fcMiss : null;
  r.fcAnnualized = isNum(r.fcMiss) ? (52 / cfg.week) * r.fcMiss : null; // U
  // V = IF(S>=1.01, 5, HLOOKUP(S, band)) — NO IFERROR; missing eff -> null
  r.fcScore = (r.cogsEff === null) ? null
    : (r.cogsEff >= 1.01 ? 5 : bandScore(r.cogsEff, cfg.bands.food_cost, undefined));

  // --- Labor (X/Y/Z/AA/AC/AD/AE/AF/AG/AH) ---
  r.laborPct = isNum(p.laborPct) ? p.laborPct : null; // X
  r.trainingCreditPct = (isNum(p.trainingCreditDollars) && isNum(r.sales) && r.sales !== 0)
    ? p.trainingCreditDollars / r.sales : null; // Y
  r.ptoPct = (isNum(p.ptoDollars) && isNum(r.sales) && r.sales !== 0)
    ? p.ptoDollars / r.sales : null; // Z
  var padPct = (isNum(st.laborPad) ? st.laborPad : 0); // blank pad -> VLOOKUP returns 0
  padPct = (isNum(r.sales) && r.sales !== 0) ? padPct / r.sales : null;
  // volume key = (N/(B4*7)) * B7 * 7
  var volume = isNum(r.sales) ? (r.sales / (cfg.week * 7)) * cfg.weeksInPeriod * 7 : null;
  var chartRowHit = laborChartRow(volume, cfg.laborChart);
  // HUB CHANGE (brief 4.3 / DEVIATIONS B1): per-store chart from the input
  // (Labor v2's IX target) when provided; workbook volume lookup otherwise.
  var chart1raw = isNum(p.chart1) ? p.chart1 : (chartRowHit ? chartRowHit.chart1 : null);
  var chart2raw = isNum(p.chart2) ? p.chart2 : (chartRowHit ? chartRowHit.chart2 : null);
  r.chart = (isNum(chart1raw) && isNum(padPct)) ? chart1raw + padPct : null;           // AA
  r._chart2 = (isNum(chart2raw) && isNum(padPct)) ? chart2raw + padPct : null;         // AB (internal only)
  // AC = X - chart1raw - padPct - Y - Z (formula order preserved)
  r.varianceToChart = (isNum(r.laborPct) && isNum(chart1raw) && isNum(padPct) && isNum(r.trainingCreditPct) && isNum(r.ptoPct))
    ? r.laborPct - chart1raw - padPct - r.trainingCreditPct - r.ptoPct : null;
  r.laborMiss = isNum(r.varianceToChart) && isNum(r.sales)
    ? (r.varianceToChart > 0 ? r.varianceToChart * r.sales : 0) : null; // AD
  r.hoursOver = isNum(r.laborMiss) ? r.laborMiss / cfg.avgWage : null;  // AE
  r.avgHoursOverPerStore = r.hoursOver;                                 // AF
  r.laborAnnualized = isNum(r.laborMiss) ? (52 / cfg.week) * r.laborMiss : null; // AG
  r.laborScore = laborScoreHoursOver(r.avgHoursOverPerStore);           // AH

  // --- Financial totals ---
  r.finScore = sumScores([r.laborScore, r.fcScore, r.salesScore]); // AJ
  r.finMiss = (isNum(r.laborMiss) && isNum(r.fcMiss)) ? r.laborMiss + r.fcMiss : null; // AK
  r.finAnnualized = (isNum(r.laborAnnualized) && isNum(r.fcAnnualized)) ? r.laborAnnualized + r.fcAnnualized : null; // AL

  // --- Operations ---
  r.bscTrainingPct = isNum(p.bscTrainingPct) ? p.bscTrainingPct : '-'; // AN: IFERROR(...,"-")
  r.bscScore = bandScore(r.bscTrainingPct, cfg.bands.bsc_training, 1); // AO: IFERROR(...,1)
  r.onTimePct = isNum(p.onTimePct) ? p.onTimePct : null;               // AQ (XLOOKUP, no fallback)
  r.onTimeScore = bandScore(r.onTimePct, cfg.bands.on_time, undefined); // AR: NO IFERROR
  r.callsPer10k = isNum(p.callsPer10k) ? p.callsPer10k : '-';          // AT: XLOOKUP fallback "-"
  r.custCount = isNum(p.custCount) ? p.custCount : null;               // Lists!V (input, not output)
  // AU = AT * (custCount/10000): text AT -> #VALUE! -> null
  r.complaints = (isNum(p.callsPer10k) && isNum(r.custCount))
    ? p.callsPer10k * (r.custCount / 10000) : null;
  r.complaintsScore = bandScore(r.callsPer10k, cfg.bands.complaints, 3); // AV: IFERROR(...,3)
  r.ecosure = isNum(p.ecosure) ? p.ecosure : 'No Audit';               // AX
  r.ecosureScore = bandScore(r.ecosure, cfg.bands.food_safety, 3);     // AY
  r.vog = isNum(p.vogScore) ? p.vogScore : null;                       // BA (source supplies avg fallback)
  r.vogResponses = isNum(p.vogResponses) ? p.vogResponses : null;      // BB
  r.vogScore = bandScore(r.vog, cfg.bands.vog, 3);                     // BC
  r.totalTrainingPct = isNum(p.totalTrainingPct) ? p.totalTrainingPct : null; // BE (no IFERROR -> #N/A)
  r.totalTrainingScore = bandScore(r.totalTrainingPct, cfg.bands.total_training, 3); // BF

  r.opsScore = sumScores([r.ecosureScore, r.complaintsScore, r.onTimeScore, r.bscScore, r.vogScore]); // BH
  r.totalPoints = (isNum(r.finScore) && isNum(r.opsScore)) ? r.finScore + r.opsScore : null; // L

  // --- Information only ---
  r.msCount = isNum(p.msCount) ? p.msCount : 0;   // BJ: IFERROR(...,0)
  r.msScore = isNum(p.msScore) ? p.msScore : 0;   // BK
  r.voids = isNum(p.voids) ? p.voids : null;      // BL
  r.voidsPct = (isNum(r.voids) && isNum(r.sales) && r.sales !== 0) ? r.voids / r.sales : null; // BM
  // BN = AVERAGE(AY,AV,AR,AO) — errors propagate
  r.totalBsc = (isNum(r.ecosureScore) && isNum(r.complaintsScore) && isNum(r.onTimeScore) && isNum(r.bscScore))
    ? (r.ecosureScore + r.complaintsScore + r.onTimeScore + r.bscScore) / 4 : null;
  r.doh = isNum(p.doh) ? p.doh : null;            // BP
  r.dohGoal = isNum(p.dohGoal) ? p.dohGoal : null; // BQ
  r.endingDollars = isNum(p.endingDollars) ? p.endingDollars : null; // BR
  r.dollarsOverGoal = isNum(p.dollarsOverGoal) ? (p.dollarsOverGoal < 0 ? 0 : p.dollarsOverGoal) : null; // BS clip

  if (r.cogsEff === null) issues.push({ level: 'warn', store: st.store, msg: 'PTD: missing IX efficiency (fc columns null)' });
  return r;
}

// PTD store-row labor score: hours-over bands (AH6).
function laborScoreHoursOver(hoursOver) {
  if (!isNum(hoursOver)) return null;
  if (hoursOver === 0) return 5;
  if (hoursOver < 1) return 4;
  if (hoursOver < 2) return 3;
  if (hoursOver < 5) return 2;
  return 1;
}

// WTD/entity labor score: actual vs chart bands (WEEKLY AD6 / PTD entity AH355).
function laborScoreChart(laborPct, chart1, chart2) {
  if (!isNum(laborPct) || !isNum(chart1) || !isNum(chart2)) return null;
  if (laborPct < chart2) return 5;
  if (laborPct < chart1) return 4;
  if (laborPct < chart1 + 0.001) return 3;
  if (laborPct < chart1 + 0.005) return 2;
  return 1;
}

// WTD store row per SPEC §2.2.
function computeStoreWtd(st, cfg, issues) {
  var w = st.wtd || {};
  var r = {
    tier: 'store',
    store: st.store,
    location: st.location != null ? st.location : null,
    gm: st.gm != null ? st.gm : null,
    doName: st.doName, sdoName: st.sdoName, rvpName: st.rvpName, entity: st.entity,
  };

  // Sales K/L/M/N
  r.sales = isNum(w.sales) ? w.sales : null;
  r.lySales = isNum(w.lySales) ? w.lySales : null;
  r.pctVsLy = (isNum(r.sales) && isNum(r.lySales) && r.lySales !== 0)
    ? (r.sales - r.lySales) / r.lySales : 'NO LY';
  r.salesScore = bandScore(r.pctVsLy, cfg.bands.sales_vs_ly, 3);

  r.tickets = isNum(w.tickets) ? w.tickets : null;
  r.lyTickets = isNum(w.lyTickets) ? w.lyTickets : null;
  r.ticketsVsLyPct = (isNum(r.tickets) && isNum(r.lyTickets) && r.lyTickets !== 0)
    ? (r.tickets - r.lyTickets) / r.lyTickets : 'NO LY';

  // Food cost P/Q/R/S — WEEKLY has NO >100% zeroing on Q
  r.cogsEff = isNum(w.cogsEff) ? w.cogsEff : null;
  r.fcMiss = isNum(w.fcMiss) ? w.fcMiss : null;
  r.fcAnnualized = isNum(r.fcMiss) ? r.fcMiss * 52 : null;
  r.fcScore = (r.cogsEff === null) ? null
    : (r.cogsEff >= 1.01 ? 5 : bandScore(r.cogsEff, cfg.bands.food_cost, undefined));

  // Labor U/V/W/X/Y/Z/AA/AB/AC/AD — volume key = K*4; PTO only
  r.laborPct = isNum(w.laborPct) ? w.laborPct : null;
  var padPct = (isNum(st.laborPad) ? st.laborPad : 0);
  padPct = (isNum(r.sales) && r.sales !== 0) ? padPct / r.sales : null;
  var chartRowHit = laborChartRow(isNum(r.sales) ? r.sales * 4 : null, cfg.laborChart);
  // HUB CHANGE (brief 4.3 / DEVIATIONS B1): per-store chart input wins.
  var wChart1 = isNum(w.chart1) ? w.chart1 : (chartRowHit ? chartRowHit.chart1 : null);
  var wChart2 = isNum(w.chart2) ? w.chart2 : (chartRowHit ? chartRowHit.chart2 : null);
  r.chart = (isNum(wChart1) && isNum(padPct)) ? wChart1 + padPct : null;   // V
  r._chart2 = (isNum(wChart2) && isNum(padPct)) ? wChart2 + padPct : null; // W (internal)
  r.ptoPct = (isNum(w.ptoDollars) && isNum(r.sales) && r.sales !== 0) ? w.ptoDollars / r.sales : null; // X
  r.varianceToChart = (isNum(r.laborPct) && isNum(r.chart) && isNum(r.ptoPct))
    ? r.laborPct - r.chart - r.ptoPct : null; // Y = U - V - X
  r.laborMiss = (isNum(r.varianceToChart) && isNum(r.sales))
    ? (r.varianceToChart > 0 ? r.varianceToChart * r.sales : 0) : null; // Z
  r.hoursOver = isNum(r.laborMiss) ? r.laborMiss / cfg.avgWage : null;  // AA
  r.avgHoursOverPerStore = r.hoursOver;                                 // AB
  r.laborAnnualized = isNum(r.laborMiss) ? r.laborMiss * 52 : null;     // AC
  r.laborScore = laborScoreChart(r.laborPct, r.chart, r._chart2);       // AD

  r.finScore = sumScores([r.laborScore, r.fcScore, r.salesScore]); // AF
  r.finMiss = (isNum(r.laborMiss) && isNum(r.fcMiss)) ? r.laborMiss + r.fcMiss : null; // AG
  r.finAnnualized = (isNum(r.laborAnnualized) && isNum(r.fcAnnualized)) ? r.laborAnnualized + r.fcAnnualized : null; // AH

  // Operations
  r.bscTrainingPct = isNum(w.bscTrainingPct) ? w.bscTrainingPct : '-'; // AJ
  r.bscScore = bandScore(r.bscTrainingPct, cfg.bands.bsc_training, 1); // AK
  r.onTimePct = isNum(w.onTimePct) ? w.onTimePct : null;               // AM
  r.onTimeScore = bandScore(r.onTimePct, cfg.bands.on_time, undefined); // AN: no IFERROR
  r.vog = isNum(w.vogScore) ? w.vogScore : null;                       // AP
  r.vogResponses = isNum(w.vogResponses) ? w.vogResponses : 0;         // AQ: IFERROR(...,0)
  r.vogScore = bandScore(r.vog, cfg.bands.vog, 3);                     // AR (computed, NOT in ops)
  r.callsPer10k = isNum(w.callsPer10k) ? w.callsPer10k : '-';          // AT
  r.custCount = isNum(w.custCount) ? w.custCount : null;
  r.complaints = (isNum(w.callsPer10k) && isNum(r.custCount))
    ? w.callsPer10k * (r.custCount / 10000) : null;                    // AU
  r.complaintsScore = bandScore(r.callsPer10k, cfg.bands.complaints, 3); // AV

  r.opsScore = sumScores([r.complaintsScore, r.onTimeScore, r.bscScore]); // AX (3 components; VOG excluded)
  r.totalPoints = (isNum(r.finScore) && isNum(r.opsScore)) ? r.finScore + r.opsScore : null; // I

  // Information only
  r.voids = isNum(w.voids) ? w.voids : null;                           // AZ
  r.voidsPct = (isNum(r.voids) && isNum(r.sales) && r.sales !== 0) ? r.voids / r.sales : null; // BA
  r.doh = isNum(w.doh) ? w.doh : null;                                 // BB
  r.dohGoal = isNum(w.dohGoal) ? w.dohGoal : null;                     // BC
  r.endingDollars = isNum(w.endingDollars) ? w.endingDollars : null;   // BD
  r.dollarsOverGoal = isNum(w.dollarsOverGoal) ? (w.dollarsOverGoal < 0 ? 0 : w.dollarsOverGoal) : null; // BE clip

  return r;
}

// ============================== aggregation ==============================

// Ordered unique values of sel() over stores (first-appearance order).
function uniqueNames(rows, sel) {
  var seen = {}, out = [];
  for (var i = 0; i < rows.length; i++) {
    var v = sel(rows[i]);
    if (v != null && v !== '' && !seen[v]) { seen[v] = true; out.push(v); }
  }
  return out;
}

/*
 * PTD aggregate row. `opts`:
 *   tier: 'do' | 'sdo' | 'rvp' | 'company' | 'entity'
 *   members: computed PTD store rows in this group
 *   name: group name; leaderTC: leader's own training-credit dollars (null if none)
 *   rollup: {cogsEff, doh, dohGoal} measured IX rollup (optional)
 *   week: Setup B4
 * Company is built separately (needs SDO rows).
 */
function aggregatePtd(name, members, opts, cfg, inputs) {
  var tier = opts.tier;
  var r = { tier: tier, name: name, storeCount: members.length };
  var lead = (inputs.leaders && inputs.leaders[name]) || null;
  r.tenureSoar = lead ? tenureDisplay(lead.tenureSoar) : '-';
  r.tenureLoc = lead ? tenureDisplay(lead.tenureLoc) : '-';
  if (tier === 'do') r.sdoName = members.length ? members[0].sdoName : null;
  if (tier === 'do' || tier === 'sdo') r.rvpName = members.length ? members[0].rvpName : null;

  // Sales: N=SUMIF; O=SUMIF(LY)+SUMIFS(current sales of NO-LY members); P=(N-O)/O.
  // ENTITY tier: plain SUMIF only — the workbook entity block has NO NO-LY addition
  // (O355 is a plain SUMIF; confirmed against the P6-W5 snapshot).
  r.sales = sumBy(members, function (m) { return m.sales; });
  r.lySales = sumBy(members, function (m) { return m.lySales; })
    + (tier === 'entity' ? 0 : sumBy(members, function (m) { return m.pctVsLy === 'NO LY' ? m.sales : null; }));
  r.pctVsLy = (r.lySales !== 0) ? (r.sales - r.lySales) / r.lySales : 'NO LY';
  r.salesScore = bandScore(r.pctVsLy, cfg.bands.sales_vs_ly, 3);

  // NEW tickets rollup (mirrors the tier's LY-sales treatment)
  r.tickets = sumBy(members, function (m) { return m.tickets; });
  r.lyTickets = sumBy(members, function (m) { return m.lyTickets; })
    + (tier === 'entity' ? 0 : sumBy(members, function (m) { return m.ticketsVsLyPct === 'NO LY' ? m.tickets : null; }));
  r.ticketsVsLyPct = (r.lyTickets !== 0) ? (r.tickets - r.lyTickets) / r.lyTickets : 'NO LY';

  // Food cost: S = measured rollup if provided, else sales-weighted from stores (entity always weighted)
  var roll = opts.rollup || {};
  r.cogsEff = isNum(roll.cogsEff) ? roll.cogsEff
    : weightedBy(members, function (m) { return m.sales; }, function (m) { return m.cogsEff; }, r.sales);
  r.fcMiss = sumBy(members, function (m) { return m.fcMiss; });
  r.fcAnnualized = sumBy(members, function (m) { return m.fcAnnualized; });
  // DEVIATION: store rule (>=1.01 -> 5) at ALL tiers (workbook DO gave 1)
  r.fcScore = (r.cogsEff === null) ? null
    : (r.cogsEff >= 1.01 ? 5 : bandScore(r.cogsEff, cfg.bands.food_cost, undefined));

  // Labor: sales-weighted X/Z/AA/AB/AC over stores
  var wSales = function (m) { return m.sales; };
  r.laborPct = weightedBy(members, wSales, function (m) { return m.laborPct; }, r.sales);
  if (tier !== 'entity') {
    r.trainingCreditPct = isNum(opts.leaderTC) && isNum(r.sales) && r.sales !== 0 ? opts.leaderTC / r.sales : null; // Y
    r.ptoPct = weightedBy(members, wSales, function (m) { return m.ptoPct; }, r.sales); // Z
  } else {
    r.trainingCreditPct = null; r.ptoPct = null;
  }
  r.chart = weightedBy(members, wSales, function (m) { return m.chart; }, r.sales);      // AA
  r._chart2 = weightedBy(members, wSales, function (m) { return m._chart2; }, r.sales);  // AB
  var wVar = weightedBy(members, wSales, function (m) { return m.varianceToChart; }, r.sales);
  // AC = weighted(store AC) - Y  (entity: no -Y)
  r.varianceToChart = (tier === 'entity') ? wVar
    : (isNum(wVar) && isNum(r.trainingCreditPct) ? wVar - r.trainingCreditPct : wVar);
  r.laborMiss = sumBy(members, function (m) { return m.laborMiss; });        // AD
  r.laborAnnualized = sumBy(members, function (m) { return m.laborAnnualized; }); // AG
  if (tier !== 'entity') {
    r.hoursOver = r.laborMiss / cfg.avgWage; // AE
    // AF: DO = AE/count; SDO/RVP = AE/count/week   (DEVIATION: dynamic counts)
    r.avgHoursOverPerStore = (tier === 'do')
      ? (r.storeCount ? r.hoursOver / r.storeCount : null)
      : (r.storeCount ? r.hoursOver / r.storeCount / cfg.week : null);
    r.laborScore = laborScoreHoursOver(r.avgHoursOverPerStore); // AH hours-over bands
  } else {
    r.hoursOver = null; r.avgHoursOverPerStore = null;
    r.laborScore = laborScoreChart(r.laborPct, r.chart, r._chart2); // entity AH chart-comparison
  }

  r.finScore = sumScores([r.laborScore, r.fcScore, r.salesScore]); // AJ
  r.finMiss = (isNum(r.laborMiss) && isNum(r.fcMiss)) ? r.laborMiss + r.fcMiss : null;
  r.finAnnualized = (isNum(r.laborAnnualized) && isNum(r.fcAnnualized)) ? r.laborAnnualized + r.fcAnnualized : null;

  // Operations
  var avgBsc = avgBy(members, function (m) { return m.bscTrainingPct; }); // AVERAGEIF skips '-'
  r.bscTrainingPct = avgBsc === null ? '-' : avgBsc;    // AN: IFERROR -> '-'
  r.bscScore = bandScore(r.bscTrainingPct, cfg.bands.bsc_training, 1); // AO
  r.onTimePct = avgBy(members, function (m) { return m.onTimePct; });  // AQ AVERAGEIF
  r.onTimeScore = bandScore(r.onTimePct, cfg.bands.on_time, undefined); // AR no IFERROR
  r.complaints = sumBy(members, function (m) { return m.complaints; }); // AU
  var custSum = sumBy(members, function (m) { return m.custCount; });
  r.callsPer10k = (custSum !== 0) ? r.complaints / (custSum / 10000) : null; // AT
  r.complaintsScore = bandScore(r.callsPer10k, cfg.bands.complaints, 3);     // AV
  var avgEco = avgBy(members, function (m) { return m.ecosure; });
  r.ecosure = avgEco === null ? '-' : avgEco;           // AX: IFERROR -> '-'
  r.ecosureScore = bandScore(r.ecosure, cfg.bands.food_safety, 3);
  // BA: response-weighted VOG, IFERROR -> 0. ENTITY tier: plain AVERAGEIF of store VOG
  // (entity rows use the generic SUMIF/AVERAGEIF machinery; confirmed against snapshot).
  if (tier === 'entity') {
    var vogA = avgBy(members, function (m) { return m.vog; });
    r.vog = vogA === null ? 0 : vogA;
  } else {
    var respSum = sumBy(members, function (m) { return m.vogResponses; });
    var vogW = (respSum !== 0)
      ? weightedBy(members, function (m) { return m.vogResponses; }, function (m) { return m.vog; }, respSum)
      : null;
    r.vog = vogW === null ? 0 : vogW;
  }
  r.vogResponses = avgBy(members, function (m) { return m.vogResponses; }); // BB AVERAGEIF
  r.vogScore = bandScore(r.vog, cfg.bands.vog, 3);      // BC
  var avgTT = avgBy(members, function (m) { return m.totalTrainingPct; });
  r.totalTrainingPct = avgTT === null ? (tier === 'do' ? 'NEW DO' : 'NEW SDO') : avgTT; // BE
  r.totalTrainingScore = bandScore(r.totalTrainingPct, cfg.bands.total_training, 3);    // BF

  r.opsScore = sumScores([r.ecosureScore, r.complaintsScore, r.onTimeScore, r.bscScore, r.vogScore]); // BH
  r.totalPoints = (isNum(r.finScore) && isNum(r.opsScore)) ? r.finScore + r.opsScore : null;

  // Information only
  if (tier === 'entity') {
    // Workbook quirk reproduced: entity BJ scores the OPS TOTAL against the VOG band (always 5 in practice).
    r.msCount = bandScore(r.opsScore, cfg.bands.vog, 3);
    var avgMs = avgBy(members, function (m) { return m.msScore; });
    r.msScore = avgMs === null ? 'NEW SDO' : avgMs; // BK: IFERROR(AVERAGEIF, "NEW SDO")
  } else {
    r.msCount = sumBy(members, function (m) { return m.msCount; }); // BJ
    var msCntSum = r.msCount;
    var msW = (msCntSum !== 0)
      ? weightedBy(members, function (m) { return m.msCount; }, function (m) { return m.msScore; }, msCntSum)
      : null;
    r.msScore = msW === null ? 0 : msW; // BK count-weighted, IFERROR -> 0
  }
  r.voids = sumPropagate(members, function (m) { return m.voids; });   // BL (SUMIF, errors propagate)
  r.voidsPct = (isNum(r.voids) && isNum(r.sales) && r.sales !== 0) ? r.voids / r.sales : null; // BM
  r.totalBsc = avgBy(members, function (m) { return m.totalBsc; });          // BN
  r.doh = isNum(roll.doh) ? roll.doh : avgBy(members, function (m) { return m.doh; });          // BP
  r.dohGoal = isNum(roll.dohGoal) ? roll.dohGoal : avgBy(members, function (m) { return m.dohGoal; }); // BQ
  r.endingDollars = avgBy(members, function (m) { return m.endingDollars; }); // BR AVERAGEIF
  r.dollarsOverGoal = sumPropagate(members, function (m) { return m.dollarsOverGoal; }); // BS SUMIF (errors propagate)

  return r;
}

// PTD company row (352): sums/averages over the SDO aggregate rows where the workbook does,
// stores elsewhere. DEVIATION: /190 becomes /liveStoreCount.
function companyPtd(sdoRows, storeRows, cfg, inputs) {
  var r = { tier: 'company', name: 'SOAR QSR', storeCount: storeRows.length };
  var roll = (inputs.rollups && inputs.rollups.company) || {};
  var sdoSales = sumBy(sdoRows, function (m) { return m.sales; });
  var wSalesSdo = function (m) { return m.sales; };

  r.sales = sdoSales;                                               // N = SUM(SDO)
  r.lySales = sumBy(sdoRows, function (m) { return m.lySales; });   // O
  r.pctVsLy = (r.lySales !== 0) ? (r.sales - r.lySales) / r.lySales : 'NO LY';
  r.salesScore = bandScore(r.pctVsLy, cfg.bands.sales_vs_ly, undefined); // Q352 no IFERROR in wb; default n/a
  r.tickets = sumBy(sdoRows, function (m) { return m.tickets; });
  r.lyTickets = sumBy(sdoRows, function (m) { return m.lyTickets; });
  r.ticketsVsLyPct = (r.lyTickets !== 0) ? (r.tickets - r.lyTickets) / r.lyTickets : 'NO LY';

  r.cogsEff = isNum(roll.cogsEff) ? roll.cogsEff
    : weightedBy(storeRows, function (m) { return m.sales; }, function (m) { return m.cogsEff; },
        sumBy(storeRows, function (m) { return m.sales; }));
  r.fcMiss = sumBy(sdoRows, function (m) { return m.fcMiss; });
  r.fcAnnualized = sumBy(sdoRows, function (m) { return m.fcAnnualized; });
  r.fcScore = (r.cogsEff === null) ? null
    : (r.cogsEff >= 1.01 ? 5 : bandScore(r.cogsEff, cfg.bands.food_cost, undefined));

  r.laborPct = weightedBy(sdoRows, wSalesSdo, function (m) { return m.laborPct; }, r.sales); // X352 over SDO
  var tcAll = inputs.leaderTrainingCredit || {};
  var leaderTC = isNum(tcAll['SOAR QSR']) ? tcAll['SOAR QSR'] : null;
  r.trainingCreditPct = (isNum(leaderTC) && r.sales !== 0) ? leaderTC / r.sales : null; // Y352
  var storeSales = sumBy(storeRows, function (m) { return m.sales; });
  r.ptoPct = weightedBy(storeRows, function (m) { return m.sales; }, function (m) { return m.ptoPct; }, storeSales); // Z352 over stores
  r.chart = weightedBy(storeRows, function (m) { return m.sales; }, function (m) { return m.chart; }, storeSales);   // AA352 over stores
  r._chart2 = weightedBy(storeRows, function (m) { return m.sales; }, function (m) { return m._chart2; }, storeSales); // AB352
  r.varianceToChart = weightedBy(sdoRows, wSalesSdo, function (m) { return m.varianceToChart; }, r.sales); // AC352 over SDO (no -Y)
  r.laborMiss = sumBy(sdoRows, function (m) { return m.laborMiss; });           // AD
  r.hoursOver = r.laborMiss / cfg.avgWage;                                      // AE
  r.avgHoursOverPerStore = r.storeCount ? r.hoursOver / r.storeCount / cfg.week : null; // AF (dynamic count)
  r.laborAnnualized = sumBy(sdoRows, function (m) { return m.laborAnnualized; }); // AG
  r.laborScore = laborScoreHoursOver(r.avgHoursOverPerStore);                   // AH352 (hours-over bands)

  r.finScore = sumScores([r.laborScore, r.fcScore, r.salesScore]);
  r.finMiss = (isNum(r.laborMiss) && isNum(r.fcMiss)) ? r.laborMiss + r.fcMiss : null; // AK
  r.finAnnualized = (isNum(r.laborAnnualized) && isNum(r.fcAnnualized)) ? r.laborAnnualized + r.fcAnnualized : null; // AL

  r.bscTrainingPct = avgBy(sdoRows, function (m) { return m.bscTrainingPct; }); // AN352 = AVERAGE(SDO)
  r.bscScore = bandScore(r.bscTrainingPct, cfg.bands.bsc_training, undefined);  // AO352 no IFERROR
  r.onTimePct = weightedBy(sdoRows, wSalesSdo, function (m) { return m.onTimePct; }, r.sales); // AQ352 sales-weighted
  r.onTimeScore = bandScore(r.onTimePct, cfg.bands.on_time, undefined);
  r.complaints = sumBy(sdoRows, function (m) { return m.complaints; }); // AU352
  var custSum = sumBy(storeRows, function (m) { return m.custCount; }); // SUM(Lists!V)
  r.callsPer10k = (custSum !== 0) ? r.complaints / (custSum / 10000) : null; // AT352
  r.complaintsScore = bandScore(r.callsPer10k, cfg.bands.complaints, 3);
  var avgEco = avgBy(sdoRows, function (m) { return m.ecosure; }); // AX352 over SDO
  r.ecosure = avgEco === null ? '-' : avgEco;
  r.ecosureScore = bandScore(r.ecosure, cfg.bands.food_safety, 3);
  // BA352/BB352 = the VOG source's own "Average" row -> measured rollup input when available,
  // else response-weighted over stores.
  if (isNum(roll.vog)) { r.vog = roll.vog; }
  else {
    var respSum = sumBy(storeRows, function (m) { return m.vogResponses; });
    var vw = (respSum !== 0)
      ? weightedBy(storeRows, function (m) { return m.vogResponses; }, function (m) { return m.vog; }, respSum) : null;
    r.vog = vw === null ? 0 : vw;
  }
  r.vogResponses = isNum(roll.vogResponses) ? roll.vogResponses
    : avgBy(storeRows, function (m) { return m.vogResponses; });
  r.vogScore = bandScore(r.vog, cfg.bands.vog, 3); // BC352
  r.totalTrainingPct = avgBy(storeRows, function (m) { return m.totalTrainingPct; }); // BE352 = AVERAGE(stores)
  r.totalTrainingScore = bandScore(r.totalTrainingPct, cfg.bands.total_training, 3);  // BF352

  // Workbook has no L/AJ/BH on the company row; we still expose ops/total for convenience.
  r.opsScore = sumScores([r.ecosureScore, r.complaintsScore, r.onTimeScore, r.bscScore, r.vogScore]);
  r.totalPoints = (isNum(r.finScore) && isNum(r.opsScore)) ? r.finScore + r.opsScore : null;

  r.msCount = sumBy(storeRows, function (m) { return m.msCount; }); // BJ352 over stores
  r.msScore = (r.msCount !== 0)
    ? weightedBy(storeRows, function (m) { return m.msCount; }, function (m) { return m.msScore; }, r.msCount)
    : null; // BK352
  r.voids = sumPropagate(sdoRows, function (m) { return m.voids; }); // BL352 (errors propagate)
  r.voidsPct = (isNum(r.voids) && r.sales !== 0) ? r.voids / r.sales : null;
  r.totalBsc = avgBy(sdoRows, function (m) { return m.totalBsc; }); // BN352 over SDO
  r.doh = isNum(roll.doh) ? roll.doh : avgBy(storeRows, function (m) { return m.doh; });
  r.dohGoal = isNum(roll.dohGoal) ? roll.dohGoal : avgBy(storeRows, function (m) { return m.dohGoal; });
  r.endingDollars = avgBy(storeRows, function (m) { return m.endingDollars; }); // BR352 over stores
  r.dollarsOverGoal = sumPropagate(sdoRows, function (m) { return m.dollarsOverGoal; }); // BS352 (errors propagate)

  return r;
}

/*
 * WTD aggregate row per SPEC §2.4. opts.tier: 'do' | 'sdo' | 'rvp'.
 */
function aggregateWtd(name, members, opts, cfg, inputs) {
  var tier = opts.tier;
  var r = { tier: tier, name: name, storeCount: members.length };
  var roll = opts.rollup || {};
  var wSales = function (m) { return m.sales; };

  r.sales = sumBy(members, function (m) { return m.sales; }); // K
  r.lySales = sumBy(members, function (m) { return m.lySales; })
    + sumBy(members, function (m) { return m.pctVsLy === 'NO LY' ? m.sales : null; }); // L
  r.pctVsLy = (r.lySales !== 0) ? (r.sales - r.lySales) / r.lySales : 'NO LY';
  r.salesScore = bandScore(r.pctVsLy, cfg.bands.sales_vs_ly, 3);

  r.tickets = sumBy(members, function (m) { return m.tickets; });
  r.lyTickets = sumBy(members, function (m) { return m.lyTickets; })
    + sumBy(members, function (m) { return m.ticketsVsLyPct === 'NO LY' ? m.tickets : null; });
  r.ticketsVsLyPct = (r.lyTickets !== 0) ? (r.tickets - r.lyTickets) / r.lyTickets : 'NO LY';

  r.cogsEff = isNum(roll.cogsEff) ? roll.cogsEff
    : weightedBy(members, wSales, function (m) { return m.cogsEff; }, r.sales);
  r.fcMiss = sumBy(members, function (m) { return m.fcMiss; });      // Q
  r.fcAnnualized = sumBy(members, function (m) { return m.fcAnnualized; }); // R
  r.fcScore = (r.cogsEff === null) ? null
    : (r.cogsEff >= 1.01 ? 5 : bandScore(r.cogsEff, cfg.bands.food_cost, undefined)); // S (deviation at all tiers)

  // Labor: U/V/W/X/Y sales-weighted over stores
  r.laborPct = weightedBy(members, wSales, function (m) { return m.laborPct; }, r.sales); // U
  r.chart = weightedBy(members, wSales, function (m) { return m.chart; }, r.sales);       // V
  r._chart2 = weightedBy(members, wSales, function (m) { return m._chart2; }, r.sales);   // W
  r.ptoPct = weightedBy(members, wSales, function (m) { return m.ptoPct; }, r.sales);     // X
  r.varianceToChart = weightedBy(members, wSales, function (m) { return m.varianceToChart; }, r.sales); // Y
  r.laborMiss = sumBy(members, function (m) { return m.laborMiss; });  // Z
  r.hoursOver = r.laborMiss / cfg.avgWage;                             // AA
  // AB: DO = AA/count; SDO/RVP = AA/count (workbook /H)  — all per-store, no /week on WEEKLY
  r.avgHoursOverPerStore = r.storeCount ? r.hoursOver / r.storeCount : null;
  // AC: SDO tier divides the summed annualized miss by store count (workbook quirk); DO/RVP plain SUMIF
  var annSum = sumBy(members, function (m) { return m.laborAnnualized; });
  r.laborAnnualized = (tier === 'sdo') ? (r.storeCount ? annSum / r.storeCount : null) : annSum;
  r.laborScore = laborScoreChart(r.laborPct, r.chart, r._chart2);      // AD chart-comparison

  r.finScore = sumScores([r.laborScore, r.fcScore, r.salesScore]); // AF
  r.finMiss = (isNum(r.laborMiss) && isNum(r.fcMiss)) ? r.laborMiss + r.fcMiss : null; // AG
  r.finAnnualized = (isNum(r.laborAnnualized) && isNum(r.fcAnnualized)) ? r.laborAnnualized + r.fcAnnualized : null; // AH

  // BSC: pct AVERAGEIF; score AVERAGED (not re-derived) — DO/RVP plain avg (IFERROR->1), SDO ROUND(avg,0)
  var avgBsc = avgBy(members, function (m) { return m.bscTrainingPct; });
  r.bscTrainingPct = avgBsc === null ? '-' : avgBsc; // AJ
  var avgBscScore = avgBy(members, function (m) { return m.bscScore; });
  if (tier === 'sdo') r.bscScore = avgBscScore === null ? 1 : excelRound0(avgBscScore);
  else r.bscScore = avgBscScore === null ? 1 : avgBscScore; // AK
  r.onTimePct = avgBy(members, function (m) { return m.onTimePct; });   // AM AVERAGEIF
  r.onTimeScore = bandScore(r.onTimePct, cfg.bands.on_time, undefined); // AN
  // VOG: AP response-weighted by AQ; AQ = SUMIF of counts
  var respSum = sumBy(members, function (m) { return m.vogResponses; });
  var vw = (respSum !== 0)
    ? weightedBy(members, function (m) { return m.vogResponses; }, function (m) { return m.vog; }, respSum) : null;
  r.vog = vw === null ? 0 : vw;
  r.vogResponses = respSum;
  r.vogScore = bandScore(r.vog, cfg.bands.vog, 3); // AR (not in ops)
  r.complaints = sumBy(members, function (m) { return m.complaints; }); // AU
  var custSum = sumBy(members, function (m) { return m.custCount; });   // WTD cust counts (Lists!Y)
  r.callsPer10k = (custSum !== 0) ? r.complaints / (custSum / 10000) : null; // AT
  r.complaintsScore = bandScore(r.callsPer10k, cfg.bands.complaints, 3);     // AV

  r.opsScore = sumScores([r.complaintsScore, r.onTimeScore, r.bscScore]); // AX
  r.totalPoints = (isNum(r.finScore) && isNum(r.opsScore)) ? r.finScore + r.opsScore : null; // I

  r.voids = sumPropagate(members, function (m) { return m.voids; });  // AZ (errors propagate)
  r.voidsPct = (isNum(r.voids) && r.sales !== 0) ? r.voids / r.sales : null; // BA
  r.doh = isNum(roll.doh) ? roll.doh : avgBy(members, function (m) { return m.doh; });          // BB
  r.dohGoal = isNum(roll.dohGoal) ? roll.dohGoal : avgBy(members, function (m) { return m.dohGoal; }); // BC
  r.endingDollars = avgBy(members, function (m) { return m.endingDollars; }); // BD
  r.dollarsOverGoal = sumPropagate(members, function (m) { return m.dollarsOverGoal; }); // BE (errors propagate)

  return r;
}

// WTD company row (354). DEVIATIONS: dynamic store count; DOH from WTD rollup/average
// (workbook read the PTD DOH sheet — dropped).
function companyWtd(sdoRows, storeRows, cfg, inputs) {
  var r = { tier: 'company', name: 'SOAR QSR', storeCount: storeRows.length };
  var roll = (inputs.rollups && inputs.rollups.wtdCompany) || {};
  var wSalesSdo = function (m) { return m.sales; };
  var storeSales = sumBy(storeRows, function (m) { return m.sales; });

  r.sales = sumBy(sdoRows, function (m) { return m.sales; });     // K = SUM(SDO)
  r.lySales = sumBy(sdoRows, function (m) { return m.lySales; }); // L
  r.pctVsLy = (r.lySales !== 0) ? (r.sales - r.lySales) / r.lySales : 'NO LY';
  r.salesScore = bandScore(r.pctVsLy, cfg.bands.sales_vs_ly, 3);
  r.tickets = sumBy(sdoRows, function (m) { return m.tickets; });
  r.lyTickets = sumBy(sdoRows, function (m) { return m.lyTickets; });
  r.ticketsVsLyPct = (r.lyTickets !== 0) ? (r.tickets - r.lyTickets) / r.lyTickets : 'NO LY';

  r.cogsEff = isNum(roll.cogsEff) ? roll.cogsEff
    : weightedBy(storeRows, function (m) { return m.sales; }, function (m) { return m.cogsEff; }, storeSales);
  r.fcMiss = sumBy(sdoRows, function (m) { return m.fcMiss; });
  r.fcAnnualized = sumBy(sdoRows, function (m) { return m.fcAnnualized; });
  r.fcScore = (r.cogsEff === null) ? null
    : (r.cogsEff >= 1.01 ? 5 : bandScore(r.cogsEff, cfg.bands.food_cost, undefined));

  r.laborPct = weightedBy(sdoRows, wSalesSdo, function (m) { return m.laborPct; }, r.sales);     // U over SDO
  r.chart = weightedBy(storeRows, function (m) { return m.sales; }, function (m) { return m.chart; }, storeSales); // V over stores
  r._chart2 = weightedBy(storeRows, function (m) { return m.sales; }, function (m) { return m._chart2; }, storeSales); // W
  r.ptoPct = weightedBy(storeRows, function (m) { return m.sales; }, function (m) { return m.ptoPct; }, storeSales);   // X over stores
  r.varianceToChart = weightedBy(sdoRows, wSalesSdo, function (m) { return m.varianceToChart; }, r.sales); // Y over SDO
  r.laborMiss = sumBy(sdoRows, function (m) { return m.laborMiss; });   // Z
  r.hoursOver = r.laborMiss / cfg.avgWage;                              // AA
  r.avgHoursOverPerStore = r.storeCount ? r.hoursOver / r.storeCount : null; // AB (dynamic count)
  r.laborAnnualized = r.storeCount ? sumBy(storeRows, function (m) { return m.laborAnnualized; }) / r.storeCount : null; // AC = SUM(stores)/count
  r.laborScore = laborScoreChart(r.laborPct, r.chart, r._chart2);       // AD

  r.finScore = sumScores([r.laborScore, r.fcScore, r.salesScore]);
  r.finMiss = (isNum(r.laborMiss) && isNum(r.fcMiss)) ? r.laborMiss + r.fcMiss : null;
  r.finAnnualized = (isNum(r.laborAnnualized) && isNum(r.fcAnnualized)) ? r.laborAnnualized + r.fcAnnualized : null;

  var avgBsc = avgBy(sdoRows, function (m) { return m.bscTrainingPct; });
  r.bscTrainingPct = avgBsc === null ? '-' : avgBsc;
  var avgBscScore = avgBy(sdoRows, function (m) { return m.bscScore; });
  r.bscScore = avgBscScore === null ? 1 : avgBscScore;
  r.onTimePct = weightedBy(sdoRows, wSalesSdo, function (m) { return m.onTimePct; }, r.sales);
  r.onTimeScore = bandScore(r.onTimePct, cfg.bands.on_time, undefined);
  var respSum = sumBy(storeRows, function (m) { return m.vogResponses; });
  var vw = (respSum !== 0)
    ? weightedBy(storeRows, function (m) { return m.vogResponses; }, function (m) { return m.vog; }, respSum) : null;
  r.vog = vw === null ? 0 : vw;
  r.vogResponses = r.storeCount ? respSum / r.storeCount : null; // AQ354 = SUM(RVP AQ)/count (dynamic)
  r.vogScore = bandScore(r.vog, cfg.bands.vog, 3);
  r.complaints = sumBy(sdoRows, function (m) { return m.complaints; }); // AU354
  var custSum = sumBy(storeRows, function (m) { return m.custCount; });
  r.callsPer10k = (custSum !== 0) ? r.complaints / (custSum / 10000) : null; // AT354
  r.complaintsScore = bandScore(r.callsPer10k, cfg.bands.complaints, 3);

  r.opsScore = sumScores([r.complaintsScore, r.onTimeScore, r.bscScore]); // AX354
  r.totalPoints = (isNum(r.finScore) && isNum(r.opsScore)) ? r.finScore + r.opsScore : null;

  r.voids = sumPropagate(sdoRows, function (m) { return m.voids; });
  r.voidsPct = (isNum(r.voids) && r.sales !== 0) ? r.voids / r.sales : null;
  r.doh = isNum(roll.doh) ? roll.doh : avgBy(storeRows, function (m) { return m.doh; });
  r.dohGoal = isNum(roll.dohGoal) ? roll.dohGoal : avgBy(storeRows, function (m) { return m.dohGoal; });
  r.endingDollars = avgBy(storeRows, function (m) { return m.endingDollars; }); // BD354 = AVERAGE(stores)
  r.dollarsOverGoal = sumPropagate(sdoRows, function (m) { return m.dollarsOverGoal; }); // BE354

  return r;
}

// ============================== tier assembly ==============================

function buildTierSet(storeRows, mode, cfg, inputs) {
  var rollups = inputs.rollups || {};
  var tcMap = inputs.leaderTrainingCredit || {};
  function rollupFor(tierKey, name) {
    var m = mode === 'ptd'
      ? rollups[tierKey]
      : rollups['wtd' + tierKey.charAt(0).toUpperCase() + tierKey.slice(1)];
    return (m && m[name]) || null;
  }
  function groupRows(keySel, tierKey) {
    var names = uniqueNames(storeRows, keySel);
    return names.map(function (name) {
      var members = storeRows.filter(function (s) { return keySel(s) === name; });
      var opts = {
        tier: tierKey,
        rollup: rollupFor(tierKey, name),
        leaderTC: isNum(tcMap[name]) ? tcMap[name] : null,
      };
      return mode === 'ptd'
        ? aggregatePtd(name, members, opts, cfg, inputs)
        : aggregateWtd(name, members, opts, cfg, inputs);
    });
  }

  var dos = groupRows(function (s) { return s.doName; }, 'do');
  var sdos = groupRows(function (s) { return s.sdoName; }, 'sdo');
  var rvps = groupRows(function (s) { return s.rvpName; }, 'rvp');
  var entities = (mode === 'ptd') ? groupRows(function (s) { return s.entity; }, 'entity') : [];
  var company = (mode === 'ptd')
    ? companyPtd(sdos, storeRows, cfg, inputs)
    : companyWtd(sdos, storeRows, cfg, inputs);

  // Ranks (RANK.EQ desc within own block)
  function applyRanks(rows) {
    var ranks = rankDesc(rows.map(function (x) { return x.totalPoints; }));
    rows.forEach(function (x, i) { x.rank = ranks[i]; });
  }
  applyRanks(storeRows);
  applyRanks(dos);
  applyRanks(sdos);
  applyRanks(rvps);
  if (entities.length) applyRanks(entities);
  company.rank = null;

  return { stores: storeRows, dos: dos, sdos: sdos, rvps: rvps, company: company, entities: entities };
}

// ============================== entry point ==============================

function runRanking(inputs) {
  var issues = [];
  var cfg = inputs.config;
  var ptdStores = inputs.stores.map(function (st) { return computeStorePtd(st, cfg, issues); });
  var wtdStores = inputs.stores.map(function (st) { return computeStoreWtd(st, cfg, issues); });
  var ptd = buildTierSet(ptdStores, 'ptd', cfg, inputs);
  var wtd = buildTierSet(wtdStores, 'wtd', cfg, inputs);
  return { ptd: ptd, wtd: wtd, issues: issues };
}

if (typeof module !== 'undefined') {
  module.exports = {
    runRanking: runRanking,
    bandScore: bandScore,
    laborChartRow: laborChartRow,
    rankDesc: rankDesc,
    laborScoreHoursOver: laborScoreHoursOver,
    laborScoreChart: laborScoreChart,
  };
}
