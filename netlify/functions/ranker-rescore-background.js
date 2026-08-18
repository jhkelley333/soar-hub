// netlify/functions/ranker-rescore-background.js
//
// Re-runs the ranking engine for every completed v2 week (from their stored
// source files), so past weeks pick up the current scoring formula, then
// refreshes ranker_week_history's DB rows with the new ranks. Use after a
// scoring change (e.g. the per-week Hrs/Store consistency change).
//
// Only v2 weeks (those with a completed ranking_runs + stored sources) can be
// rescored — the legacy v1 sheet weeks carry the sheet's OWN ranks and aren't
// produced by this engine, so they're left as-is.
//
// Background function (‑background): re-running ~8+ weeks × the full pipeline
// exceeds the 10s synchronous limit.
//
//   POST /.netlify/functions/ranker-rescore-background

import { supabaseAdmin, getCallerProfile } from "./_lib/ranker-sheets.js";
import { runRankingNow } from "./_lib/ranking/run.js";
import { backfillDb, completeRunWeeks } from "./_lib/rankerHistory.js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 202, body: "" };

  let profile;
  try {
    profile = await getCallerProfile(event);
  } catch (e) {
    console.error("[ranker-rescore] auth error:", e?.message || e);
    return { statusCode: 202, body: "" };
  }
  if (!profile || profile.role !== "admin") {
    console.warn("[ranker-rescore] non-admin caller");
    return { statusCode: 202, body: "" };
  }

  try {
    const supa = supabaseAdmin();
    const weeks = await completeRunWeeks(supa);
    let ok = 0, failed = 0;
    for (const weekEnding of weeks) {
      try {
        const res = await runRankingNow(supa, profile, { weekEnding });
        if (res?.error) { failed++; console.warn(`[ranker-rescore] ${weekEnding}: ${res.error}`); }
        else ok++;
      } catch (e) {
        failed++;
        console.warn(`[ranker-rescore] ${weekEnding} threw:`, e?.message || e);
      }
    }
    // Refresh the DB rows in the history table with the rescored ranks.
    const dbN = await backfillDb(supa);
    console.log(`[ranker-rescore] done — reran ${ok}/${weeks.length} weeks (${failed} failed), refreshed ${dbN} history rows`);
  } catch (e) {
    console.error("[ranker-rescore] error:", e?.message || e);
  }
  return { statusCode: 202, body: "" };
};
