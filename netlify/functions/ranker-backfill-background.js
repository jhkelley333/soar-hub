// netlify/functions/ranker-backfill-background.js
//
// Backfills ranker_week_history from BOTH sources:
//   - legacy v1 weeks in the Google Sheet (one tab per fiscal week), and
//   - v2 weeks already in ranking_rows.
// Idempotent — re-running just refreshes rows (upsert on the primary key).
//
// Runs as a Netlify background function (‑background suffix) because reading
// ~30 sheet weeks × ~271 stores and upserting the lot far exceeds the 10s
// synchronous limit. The admin kicks it via ranker-backfill.js and watches the
// row count climb.
//
//   POST /.netlify/functions/ranker-backfill-background

import { supabaseAdmin, getCallerProfile } from "./_lib/ranker-sheets.js";
import { backfillSheet, backfillDb } from "./_lib/rankerHistory.js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 202, body: "" };

  let profile;
  try {
    profile = await getCallerProfile(event);
  } catch (e) {
    console.error("[ranker-backfill] auth error:", e?.message || e);
    return { statusCode: 202, body: "" };
  }
  if (!profile || profile.role !== "admin") {
    console.warn("[ranker-backfill] non-admin caller");
    return { statusCode: 202, body: "" };
  }

  try {
    const supa = supabaseAdmin();
    const sheetN = await backfillSheet(supa);
    const dbN = await backfillDb(supa);
    console.log(`[ranker-backfill] done — sheet rows: ${sheetN}, db rows: ${dbN}`);
  } catch (e) {
    console.error("[ranker-backfill] error:", e?.message || e);
  }
  return { statusCode: 202, body: "" };
};
