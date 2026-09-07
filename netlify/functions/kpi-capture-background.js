// kpi-capture-background — the reliable primary trigger for the KPI feed
// capture. The "-background" suffix makes this a Netlify BACKGROUND function:
// Netlify returns 202 to the caller immediately and lets the handler run up to
// 15 minutes. That removes the ~10s synchronous wall that made the plain
// kpi-capture function return HTTP 502 whenever the feed was slow (the morning
// fill-in window), writing nothing and forcing a manual refresh.
//
// Because the response is 202-with-no-body, the caller can't read the outcome
// here — success/failure is recorded in kpi_pull_log (source "cron-bg"), which
// the KPI pull log and capture-watchdog already read, and the catch-up loop
// polls kpi-capture?status=1 (the data itself) to know when the day has landed.
//
// The heavy lifting is shared with kpi-capture.js via _lib/runKpiCapture.js.
// This path uses a generous fetch budget since it has minutes, not seconds, and
// runs the Ranker week-end auto-advance. Every write is an idempotent upsert,
// so firing this alongside the synchronous path never duplicates.
//
//   ?force=1   capture now regardless of the capture-hours gate.

import { createClient } from "@supabase/supabase-js";
import { runKpiCapture, CAPTURE_HOURS, TZ } from "./_lib/runKpiCapture.js";
import { wallClockInTz } from "./_lib/kpiLabor.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Generous fetch budget — a background function has 15 minutes, so wait the
// feed out rather than bail. Still retries a transient blip.
const BG_FETCH = { attempts: 3, timeoutMs: 25000, backoffMs: 2000 };

export const handler = async (event) => {
  const force = event?.queryStringParameters?.force === "1";
  const wc = wallClockInTz(new Date(), TZ);

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log("[kpi-capture:cron-bg] not configured (env vars missing)");
    return { statusCode: 200 };
  }
  if (!force && !CAPTURE_HOURS.includes(wc.hour)) {
    console.log(`[kpi-capture:cron-bg] skip — ${wc.hour}:00 CT is not a capture hour`);
    return { statusCode: 200 };
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await runKpiCapture(supa, { wc, source: "cron-bg", fetch: BG_FETCH, runRanker: true });
  console.log(`[kpi-capture:cron-bg] ${result.body}`);
  // Return value is ignored by Netlify for background functions (already 202'd).
  return { statusCode: 200 };
};
