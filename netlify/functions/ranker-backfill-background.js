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

import {
  supabaseAdmin, getCallerProfile,
  getSheetsClient, getAvailableWeeks, batchGetWeeks,
  buildStoreMetricObject, getStoreDigits, parseNum,
} from "./_lib/ranker-sheets.js";

const SHEET_CHUNK = 8;   // weeks per Sheets batchGet
const UPSERT_CHUNK = 500; // rows per DB upsert

async function upsertRows(supa, rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supa
      .from("ranker_week_history")
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "store_number,week_key" });
    if (error) throw new Error(error.message);
  }
}

// ── legacy sheet weeks ───────────────────────────────────────────────────────
async function backfillSheet(supa) {
  let sheets;
  try {
    sheets = await getSheetsClient();
  } catch (e) {
    console.warn("[ranker-backfill] sheets client unavailable, skipping sheet:", e?.message || e);
    return 0;
  }
  const weeks = await getAvailableWeeks(sheets);
  let written = 0;
  for (let i = 0; i < weeks.length; i += SHEET_CHUNK) {
    const chunk = weeks.slice(i, i + SHEET_CHUNK).map(String);
    const wkMap = await batchGetWeeks(sheets, chunk);
    const rows = [];
    for (const wkStr of chunk) {
      const wk = wkMap.get(wkStr) || { idx: {}, rows: [] };
      const n = parseInt(wkStr, 10);
      for (const r of wk.rows) {
        const m = buildStoreMetricObject(r, wk.idx);
        const num = getStoreDigits(m.storeNum);
        const rank = parseNum(m.storeRank);
        if (!num || rank == null) continue;
        rows.push({
          store_number: String(num),
          week_key: `S${n}`,
          source: "sheet",
          fiscal_week: n,
          week_ending: null,
          rank: Math.round(rank),
          total_points: null,
          gm_name: m.gmName || null,
        });
      }
    }
    if (rows.length) {
      await upsertRows(supa, rows);
      written += rows.length;
    }
  }
  return written;
}

// ── v2 DB weeks ──────────────────────────────────────────────────────────────
async function backfillDb(supa) {
  // Latest COMPLETE run per week_ending (dedupe re-runs of the same week).
  const { data: runs } = await supa
    .from("ranking_runs")
    .select("id, week_ending, started_at")
    .eq("status", "complete")
    .order("week_ending", { ascending: true })
    .order("started_at", { ascending: false });
  const latestByWeek = new Map();
  for (const r of runs || []) {
    if (!latestByWeek.has(r.week_ending)) latestByWeek.set(r.week_ending, r.id);
  }

  let written = 0;
  for (const [weekEnding, runId] of latestByWeek) {
    // Page store-tier PTD rows for this run.
    const storeRows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supa
        .from("ranking_rows")
        .select("entity_key, rank, total_points, metrics")
        .eq("run_id", runId).eq("scope", "ptd").eq("tier", "store")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      storeRows.push(...data);
      if (data.length < 1000) break;
    }
    const rows = storeRows
      .filter((r) => r.rank != null && r.entity_key)
      .map((r) => ({
        store_number: String(r.entity_key),
        week_key: `D${weekEnding}`,
        source: "db",
        fiscal_week: null,
        week_ending: weekEnding,
        rank: r.rank,
        total_points: r.total_points ?? null,
        gm_name: r.metrics?.gm || null,
      }));
    if (rows.length) {
      await upsertRows(supa, rows);
      written += rows.length;
    }
  }
  return written;
}

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
