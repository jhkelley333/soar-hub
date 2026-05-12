// netlify/functions/ranker.js
//
// Ranker — weekly store performance read API. Auth via Supabase JWT;
// scope filtering via user_visible_stores RPC; metrics live in the
// Google Sheet identified by SOAR_METRICS_SHEET_ID (one tab per week).
// One Sheets batchGet call per request fetches the current week +
// prior week + trend window.
//
// Replaces the legacy /.netlify/functions/command-center entry. Action
// names match the contract the React Ranker module expects.
//
//   GET ?action=getInit
//     -> { ok, currentWeek, availableWeeks, allStores }
//
//   GET ?action=getWarRoom&week=N
//     -> portfolio scoped to caller's visible stores
//
//   GET ?action=getStoreDashboard&week=N&store=S&peerStore=P&trendWeeks=4|8|12
//     -> metrics + priorMetrics + rankMovement + trends + peer +
//        executionScore + momentum

import {
  corsOptions, respond,
  supabaseAdmin, getCallerProfile, getCallerStoreNumbers,
  getSheetsClient, getAvailableWeeks, batchGetWeeks,
  findRowByStore, getMetricRaw, buildStoreMetricObject,
  parseNum, getStoreDigits, average,
  FIXED_COL, TREND_METRICS,
} from "./_lib/ranker-sheets.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return corsOptions();

  const profile = await getCallerProfile(event);
  if (!profile) return respond(401, { ok: false, message: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "";

  try {
    const supa = supabaseAdmin();
    const sheets = await getSheetsClient();

    if (action === "getInit") {
      return await getInit(supa, sheets, profile);
    }
    if (action === "getWarRoom") {
      return await getWarRoom(supa, sheets, profile, params);
    }
    if (action === "getStoreDashboard") {
      return await getStoreDashboard(supa, sheets, profile, params);
    }
    return respond(400, { ok: false, message: `unknown action: ${action}` });
  } catch (e) {
    console.error("[ranker] error:", e);
    return respond(500, { ok: false, message: e.message || "server error" });
  }
};

// ── getInit ────────────────────────────────────────────────────────────────
async function getInit(supa, sheets, profile) {
  const [availableWeeks, allStores] = await Promise.all([
    getAvailableWeeks(sheets),
    getCallerStoreNumbers(supa, profile),
  ]);
  // Default "current week" = most recent available tab. The legacy
  // calendar-week formula drifted from Sonic's fiscal calendar; using
  // "latest tab" lets corporate define the cadence by adding tabs.
  const currentWeek = availableWeeks.length
    ? availableWeeks[availableWeeks.length - 1]
    : null;
  return respond(200, { ok: true, currentWeek, availableWeeks, allStores });
}

// ── getStoreDashboard ──────────────────────────────────────────────────────
async function getStoreDashboard(supa, sheets, profile, params) {
  const week      = String(params.week      || "").trim();
  const store     = String(params.store     || "").trim();
  const peerStore = String(params.peerStore || "").trim();
  const trendWeeksParam = parseInt(params.trendWeeks || "4", 10);
  const trendWeeks = [4, 8, 12].includes(trendWeeksParam) ? trendWeeksParam : 4;

  if (!week || !store) {
    return respond(400, { ok: false, message: "week and store required." });
  }

  // Scope check on the requested store.
  const visible = await getCallerStoreNumbers(supa, profile);
  if (!visible.includes(store)) {
    return respond(403, { ok: false, message: "store outside your scope" });
  }

  // Build the needed-weeks set: current + prior + trend window. One
  // batchGet call covers all of them.
  const weekNum = Number(week);
  const trendWeekStrs = [];
  for (let i = trendWeeks - 1; i >= 0; i--) {
    const w = weekNum - i;
    if (w >= 1) trendWeekStrs.push(String(w));
  }
  const priorWeekStr = String(weekNum - 1);
  const allWeekStrs = Array.from(new Set([
    ...trendWeekStrs,
    week,
    ...(weekNum > 1 ? [priorWeekStr] : []),
  ]));

  const wkMap = await batchGetWeeks(sheets, allWeekStrs);
  const wk    = wkMap.get(week) || { headers: [], idx: {}, rows: [] };

  const row = findRowByStore(wk.rows, store);
  if (!row) {
    return respond(200, { ok: true, found: false, store, week });
  }

  const metrics = buildStoreMetricObject(row, wk.idx);

  // Prior week.
  let priorMetrics = null;
  let rankMovement = null;
  if (weekNum > 1) {
    const pw   = wkMap.get(priorWeekStr) || { headers: [], idx: {}, rows: [] };
    const prow = findRowByStore(pw.rows, store);
    if (prow) {
      priorMetrics = buildStoreMetricObject(prow, pw.idx);
      const cur  = parseNum(metrics.storeRank);
      const last = parseNum(priorMetrics.storeRank);
      if (cur !== null && last !== null) {
        rankMovement = { currentRank: cur, lastRank: last, change: cur - last };
      }
    }
  }

  // Trends (one entry per requested week, null where missing).
  const seriesByMetric = {};
  for (const k of TREND_METRICS) seriesByMetric[k] = [];
  for (const ws of trendWeekStrs) {
    const w = wkMap.get(ws) || { headers: [], idx: {}, rows: [] };
    const r = findRowByStore(w.rows, store);
    for (const k of TREND_METRICS) {
      seriesByMetric[k].push(parseNum(getMetricRaw(r, w.idx, k)));
    }
  }
  const trends = { weeks: trendWeekStrs, seriesByMetric };

  // Peers (top 12 by smallest sales gap inside the current week).
  const peerCandidates = getPeerCandidates(wk.rows, wk.idx, store);
  const selectedPeerStore =
    peerStore || (peerCandidates.length ? peerCandidates[0].store : "");
  let peer = null;
  if (selectedPeerStore) {
    const peerRow = findRowByStore(wk.rows, selectedPeerStore);
    if (peerRow) {
      peer = { store: selectedPeerStore, metrics: buildStoreMetricObject(peerRow, wk.idx) };
    }
  }

  const executionScore = computeExecutionScore(metrics);
  const momentum       = buildMomentum(metrics, priorMetrics);

  return respond(200, {
    ok: true, found: true, store, week, trendWeeks,
    metrics, priorMetrics, rankMovement, trends,
    peerCandidates, selectedPeerStore, peer,
    executionScore, momentum,
  });
}

// ── getWarRoom ─────────────────────────────────────────────────────────────
async function getWarRoom(supa, sheets, profile, params) {
  const week = String(params.week || "").trim();
  if (!week) return respond(400, { ok: false, message: "week required." });

  const visible = await getCallerStoreNumbers(supa, profile);
  if (!visible.length) {
    return respond(200, {
      ok: true, week, storeCount: 0,
      avgWeeklySales: null, avgLaborPct: null, avgRank: null, avgVogCount: null,
      topSales: [], topImprovers: [], rankDecliners: [],
      coachingPriorities: [], recognition: [], portfolioRows: [],
    });
  }

  const weekNum = Number(week);
  const needed = [week, ...(weekNum > 1 ? [String(weekNum - 1)] : [])];
  const wkMap  = await batchGetWeeks(sheets, needed);
  const wk     = wkMap.get(week) || { headers: [], idx: {}, rows: [] };

  const portfolio = getPortfolioRows(wk.rows, wk.idx, visible);

  // Prior-week rank for rankChange.
  const priorRankByStore = new Map();
  if (weekNum > 1) {
    const pw = wkMap.get(String(weekNum - 1)) || { headers: [], idx: {}, rows: [] };
    const priorPortfolio = getPortfolioRows(pw.rows, pw.idx, visible);
    for (const p of priorPortfolio) priorRankByStore.set(p.store, p.storeRank);
  }

  const withRankChange = portfolio.map(p => {
    const prior  = priorRankByStore.get(p.store);
    const change = (p.storeRank !== null && prior !== null && prior !== undefined)
      ? p.storeRank - prior : null;
    return { ...p, rankChange: change };
  });

  const topImprovers = withRankChange
    .filter(p => p.rankChange !== null && p.rankChange < 0)
    .sort((a, b) => a.rankChange - b.rankChange)
    .slice(0, 5)
    .map(p => ({ store: p.store, storeName: p.storeName, currentRank: p.storeRank, rankChange: p.rankChange }));

  const rankDecliners = withRankChange
    .filter(p => p.rankChange !== null && p.rankChange > 0)
    .sort((a, b) => b.rankChange - a.rankChange)
    .slice(0, 5)
    .map(p => ({ store: p.store, storeName: p.storeName, currentRank: p.storeRank, rankChange: p.rankChange }));

  const coachingPriorities = portfolio
    .map(p => {
      const issues = [];
      if (p.laborPct   !== null && p.laborPct   > 30) issues.push("Labor elevated");
      if (p.complaints !== null && p.complaints > 5)  issues.push("High complaints");
      if (p.vogCount   !== null && p.vogCount   < 10) issues.push("VOG below 10");
      let priority = "LOW";
      if ((p.laborPct !== null && p.laborPct > 30) || (p.complaints !== null && p.complaints > 5)) priority = "HIGH";
      else if ((p.laborPct !== null && p.laborPct > 28) || (p.vogCount !== null && p.vogCount < 15)) priority = "MED";
      return { store: p.store, storeName: p.storeName, priority, issues: issues.join(", ") || "Monitor" };
    })
    .filter(p => p.priority !== "LOW")
    .sort((a, b) => a.priority === "HIGH" ? -1 : 1);

  const recognition = portfolio
    .filter(p => parseNum(p.complaints) === 0 && parseNum(p.vogCount) >= 21)
    .map(p => ({ store: p.store, storeName: p.storeName, wins: "Zero complaints & VOG on target" }));

  const topSales = portfolio
    .slice()
    .sort((a, b) => (b.weeklySales || 0) - (a.weeklySales || 0))
    .slice(0, 5);

  return respond(200, {
    ok: true, week,
    storeCount:     portfolio.length,
    avgWeeklySales: average(portfolio.map(p => p.weeklySales)),
    avgLaborPct:    average(portfolio.map(p => p.laborPct)),
    avgRank:        average(portfolio.map(p => p.storeRank)),
    avgVogCount:    average(portfolio.map(p => p.vogCount)),
    topSales, topImprovers, rankDecliners,
    coachingPriorities, recognition,
    portfolioRows: withRankChange,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getPeerCandidates(rows, idxMap, store) {
  const mineRow = findRowByStore(rows, store);
  if (!mineRow) return [];
  const mySales = parseNum(getMetricRaw(mineRow, idxMap, "weeklySales"));
  if (mySales === null) return [];
  const peers = [];
  for (const r of rows) {
    const peerStore = getStoreDigits(r[FIXED_COL.storeNum]);
    if (!peerStore || peerStore === String(store)) continue;
    const peerSales = parseNum(getMetricRaw(r, idxMap, "weeklySales"));
    if (peerSales === null || peerSales === 0) continue;
    peers.push({
      store: peerStore,
      storeName: String(r[FIXED_COL.storeName] || "").trim(),
      gmName:    String(r[FIXED_COL.gmName]    || "").trim(),
      weeklySales: peerSales,
      salesGapAbs: Math.abs(peerSales - mySales),
    });
  }
  peers.sort((a, b) => a.salesGapAbs - b.salesGapAbs);
  return peers.slice(0, 12);
}

function getPortfolioRows(rows, idxMap, stores) {
  const wanted = new Set((stores || []).map(s => String(s).trim()));
  const out = [];
  for (const r of rows) {
    const store = getStoreDigits(r[FIXED_COL.storeNum]);
    if (!store || !wanted.has(store)) continue;
    out.push({
      store,
      storeName:   String(r[FIXED_COL.storeName] || "").trim(),
      gmName:      String(r[FIXED_COL.gmName]    || "").trim(),
      storeRank:   parseNum(getMetricRaw(r, idxMap, "storeRank")),
      weeklySales: parseNum(getMetricRaw(r, idxMap, "weeklySales")),
      vsLastYear:  parseNum(getMetricRaw(r, idxMap, "vsLastYear")),
      laborPct:    parseNum(getMetricRaw(r, idxMap, "laborPct")),
      vogWeek:     parseNum(getMetricRaw(r, idxMap, "vogWeek")),
      vogCount:    parseNum(getMetricRaw(r, idxMap, "vogCount")),
      complaints:  parseNum(getMetricRaw(r, idxMap, "complaints")),
      callsPer10k: parseNum(getMetricRaw(r, idxMap, "callsPer10k")),
      varToChart:  parseNum(getMetricRaw(r, idxMap, "varToChart")),
    });
  }
  return out;
}

// Composite "how is this store executing right now" score 0..100.
// Returns null when none of the inputs are present — caller should
// render "—" instead of a misleading 0.
function computeExecutionScore(metrics) {
  let score = 0, max = 0;
  const labor = parseNum(metrics.laborPct);
  if (labor !== null) {
    max += 25;
    if      (labor <= 26) score += 25;
    else if (labor <= 28) score += 18;
    else if (labor <= 30) score += 10;
  }
  const vog = parseNum(metrics.vogCount);
  if (vog !== null) {
    max += 25;
    if      (vog >= 21) score += 25;
    else if (vog >= 15) score += 15;
    else if (vog >= 10) score += 8;
  }
  const complaints = parseNum(metrics.complaints);
  if (complaints !== null) {
    max += 25;
    if      (complaints === 0) score += 25;
    else if (complaints <= 2)  score += 15;
    else if (complaints <= 5)  score += 8;
  }
  const bsc = parseNum(metrics.bscTraining);
  if (bsc !== null) {
    max += 25;
    const pct = Math.abs(bsc) <= 1 ? bsc * 100 : bsc;
    if      (pct >= 95) score += 25;
    else if (pct >= 85) score += 15;
    else if (pct >= 75) score += 8;
  }
  if (max === 0) return null;
  return Math.round((score / max) * 100);
}

function buildMomentum(metrics, prior) {
  if (!prior) return { sales: "Stable", labor: "Stable", guest: "Stable" };
  const sales  = parseNum(metrics.weeklySales), psales = parseNum(prior.weeklySales);
  const labor  = parseNum(metrics.laborPct),    plabor = parseNum(prior.laborPct);
  const guest  = parseNum(metrics.vogWeek),     pguest = parseNum(prior.vogWeek);
  return {
    sales: (sales !== null && psales !== null) ? (sales > psales ? "Improving" : "Softening") : "Stable",
    labor: (labor !== null && plabor !== null) ? (labor < plabor ? "Improving" : "Rising")    : "Stable",
    guest: (guest !== null && pguest !== null) ? (guest > pguest ? "Improving" : "Softening") : "Stable",
  };
}
