// netlify/functions/_lib/rankerHistory.js
//
// Shared backfill of ranker_week_history from both sources — the legacy v1
// Google Sheet weeks and the v2 ranking_rows weeks. Used by the backfill job
// and the rescore job (which re-runs the engine, then refreshes the DB weeks
// here). Idempotent (upsert on the primary key).

import {
  getSheetsClient, getAvailableWeeks, batchGetWeeks,
  buildStoreMetricObject, getStoreDigits, parseNum,
} from "./ranker-sheets.js";

const SHEET_CHUNK = 8;    // weeks per Sheets batchGet
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
export async function backfillSheet(supa) {
  let sheets;
  try {
    sheets = await getSheetsClient();
  } catch (e) {
    console.warn("[ranker-history] sheets client unavailable, skipping sheet:", e?.message || e);
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
export async function backfillDb(supa) {
  // Latest COMPLETE run per week_ending (dedupe re-runs of the same week — so a
  // rescore's fresh run supersedes the old one here).
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

// Distinct week-ending Sundays that have a completed run (the weeks a rescore
// can re-run).
export async function completeRunWeeks(supa) {
  const { data } = await supa
    .from("ranking_runs")
    .select("week_ending")
    .eq("status", "complete")
    .order("week_ending", { ascending: true });
  return [...new Set((data || []).map((r) => r.week_ending))];
}
