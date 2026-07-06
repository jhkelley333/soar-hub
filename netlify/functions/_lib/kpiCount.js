// Extract per-store daily COUNT scores from the KPI feed payload. Same feed
// as labor (Expressway KPI); these three scores ride on the per-store rows:
//   dailyScore, completionScore, accuracyScore  (fractions, e.g. 0.67 = 67%)
//
// Where exactly the feed carries them isn't visible from the repo, so this is
// defensive: it first reads the scores off the daily store rows (the same
// businessDateData rows labor uses), and if none of those carry a score, it
// scans every other array section in rawData for rows that do, joined by
// store number. kpi-capture logs how many count rows it found so a live feed
// that puts them elsewhere is diagnosable, not silently empty.

import { isStoreRow, storeNumberOf } from "./kpiOrg.js";

const numOrNull = (v) => (typeof v === "number" && isFinite(v) ? v : null);

const SCORE_KEYS = ["dailyScore", "completionScore", "accuracyScore"];
const hasAnyScore = (r) => r && SCORE_KEYS.some((k) => typeof r[k] === "number");

function scoresOf(r) {
  return {
    daily_score: numOrNull(r?.dailyScore),
    completion_score: numOrNull(r?.completionScore),
    accuracy_score: numOrNull(r?.accuracyScore),
    total_intellicost_pct: numOrNull(r?.totalIntelliCostPercentage),
  };
}

// Build a store_number -> score-row map from any rawData array section whose
// rows are store rows carrying at least one score. Used as a fallback when
// the daily rows don't themselves carry the scores.
function scoreRowsFromSections(rd) {
  const byNumber = new Map();
  for (const key of Object.keys(rd || {})) {
    const arr = rd[key];
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (!isStoreRow(r) || !hasAnyScore(r)) continue;
      const number = storeNumberOf(r);
      if (number && !byNumber.has(number)) byNumber.set(number, r);
    }
  }
  return byNumber;
}

export function extractCountRows(payload) {
  const rd = payload?.rawData || {};
  const dayRows = Array.isArray(rd.businessDateData) ? rd.businessDateData : [];

  // Primary: scores live on the same daily store rows.
  const out = [];
  let onDailyRows = 0;
  for (const r of dayRows) {
    if (!isStoreRow(r)) continue;
    const number = storeNumberOf(r);
    if (!number) continue;
    if (hasAnyScore(r)) {
      onDailyRows++;
      out.push({ store_number: number, ...scoresOf(r) });
    }
  }
  if (onDailyRows > 0) return out;

  // Fallback: scores are in some other section — join by store number onto
  // the daily store list so we still key rows to real stores.
  const byNumber = scoreRowsFromSections(rd);
  if (!byNumber.size) return [];
  const fallback = [];
  const seen = new Set();
  for (const r of dayRows) {
    if (!isStoreRow(r)) continue;
    const number = storeNumberOf(r);
    if (!number || seen.has(number)) continue;
    const sr = byNumber.get(number);
    if (sr) {
      seen.add(number);
      fallback.push({ store_number: number, ...scoresOf(sr) });
    }
  }
  // If the daily rows didn't cover them, take the score rows directly.
  if (!fallback.length) {
    for (const [number, sr] of byNumber) fallback.push({ store_number: number, ...scoresOf(sr) });
  }
  return fallback;
}
