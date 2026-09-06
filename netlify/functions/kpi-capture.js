// kpi-capture — synchronous entrypoint for the Expressway KPI feed capture.
//
// The heavy lifting lives in _lib/runKpiCapture.js and is shared with
// kpi-capture-background.js. This synchronous path is the BACKUP + manual +
// status surface; the reliable primary trigger is the background function
// (15-min limit, can't time out). See that file and the workflows.
//
// Why this path is fail-fast: Netlify gives a synchronous function ~10 seconds.
// The old code fetched the feed with up to 3×15s attempts, then did all the
// downstream work, all behind that wall — so a slow feed (exactly the morning
// "back office is still filling it in" window) blew past 10s and Netlify
// returned HTTP 502, writing nothing. Now the feed fetch here is capped tight;
// a slow feed returns a clean 200 "not ready" and the next poll gets it, and
// the background function (with minutes to spare) is what actually carries the
// day. Every write is an idempotent upsert, so both paths are safe to overlap.
//
// Modes (query params):
//   ?status=1  read-only — no feed fetch. Reports whether the day's data has
//              landed, for the catch-up workflow's poll loop. Returns JSON.
//   ?force=1   capture now regardless of the capture-hours gate (manual test).
//   (none)     capture if inside CAPTURE_HOURS, else skip.

import { createClient } from "@supabase/supabase-js";
import { runKpiCapture, CAPTURE_HOURS, TZ } from "./_lib/runKpiCapture.js";
import { wallClockInTz } from "./_lib/kpiLabor.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Fail-fast fetch budget: one short attempt so the whole synchronous request
// finishes well inside Netlify's ~10s wall even when the feed hangs.
const SYNC_FETCH = { attempts: 1, timeoutMs: 7000, backoffMs: 0 };

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// The business date today's captures should be landing (feed lags ~1 day).
function expectedBusinessDate(wc) {
  const t = new Date(Date.UTC(wc.year, wc.month - 1, wc.day) - 86400000);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const handler = async (event) => {
  const q = event?.queryStringParameters || {};
  const force = q.force === "1";
  const wc = wallClockInTz(new Date(), TZ);

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 200, body: "kpi-capture not configured (env vars missing)" };
  }
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Status read: does the day's data appear to have landed yet? ────────────
  // Used by the catch-up loop to decide whether to keep polling. Read-only, no
  // feed fetch, so it always returns fast. Threshold via CATCHUP_MIN_ROWS
  // (default 200 of ~271 stores) — "landed" means a healthy pull, not just >0,
  // so a thin early-fill-in pull doesn't stop the loop prematurely.
  if (q.status === "1") {
    const businessDate = expectedBusinessDate(wc);
    const minRows = parseInt(process.env.CATCHUP_MIN_ROWS, 10) || 200;
    const { count } = await supa
      .from("labor_v2_daily").select("store_number", { count: "exact", head: true })
      .eq("business_date", businessDate);
    const { data: lastOk } = await supa
      .from("kpi_pull_log").select("created_at")
      .eq("ok", true).order("created_at", { ascending: false }).limit(1);
    const rows = count ?? 0;
    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({
        business_date: businessDate,
        rows,
        min_rows: minRows,
        landed: rows >= minRows,
        last_ok_pull: lastOk?.[0]?.created_at || null,
        checked_at: new Date().toISOString(),
      }),
    };
  }

  if (!force && !CAPTURE_HOURS.includes(wc.hour)) {
    return { statusCode: 200, body: `skip — ${wc.hour}:00 CT is not a capture hour` };
  }

  const result = await runKpiCapture(supa, { wc, source: force ? "manual" : "cron", fetch: SYNC_FETCH });
  return { statusCode: result.statusCode, body: result.body };
};

// Backup Netlify-native trigger. The reliable primary is the GitHub Actions
// workflow driving kpi-capture-background. Fire on every UTC hour that could be
// 7 AM–10 PM Central (CST or CDT); the handler's CAPTURE_HOURS gate then keeps
// it to the real Central window regardless of DST, and idempotent upserts make
// a redundant fire (alongside the background path) a no-op.
export const config = {
  schedule: "0 0-4,12-23 * * *",
};
