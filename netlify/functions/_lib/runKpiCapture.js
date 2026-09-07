// Shared KPI-capture core. Extracted from kpi-capture.js so the same capture
// can run behind two entrypoints with different time budgets:
//   - kpi-capture.js            — synchronous (Netlify's ~10s HTTP wall). Used
//                                 for manual ?force=1 runs, the ?status=1 read,
//                                 and the Netlify-native backup schedule. Runs
//                                 with a FAIL-FAST fetch budget so a slow feed
//                                 returns "not ready" instead of hanging past
//                                 the wall and 502-ing.
//   - kpi-capture-background.js — Netlify background function (15-min limit).
//                                 The reliable primary trigger; can't time out,
//                                 so it uses a generous fetch budget and always
//                                 finishes the downstream work (labor, count,
//                                 closes, ranker).
//
// Every write is an idempotent upsert (kpi_snapshots on (central_date,
// central_hour); labor_v2_daily on (store_number,business_date)), so firing
// both paths — or the same path repeatedly — never duplicates and later pulls
// simply converge the day's numbers as the feed fills in.

import {
  extractLaborRows, feedBusinessDate,
  isPre0238Error, isPre0272Error, isPreMixError, isPreHoursError,
  stripMixCols, stripRankingCols, stripTicketCols, stripHoursCols,
  wallClockInTz,
} from "./kpiLabor.js";
import { extractCountRows, isPreCountExtrasError, stripCountExtras } from "./kpiCount.js";
import { upsertLaborCloses } from "./laborCloses.js";
import { logPull } from "./pullLog.js";
import { pingHeartbeat } from "./heartbeat.js";
import { fiscalForDate } from "./fiscal.js";
import { runRankingNow } from "./ranking/run.js";

const KPI_URL = process.env.SKUNKWORKS_KPI_URL;
const KPI_TOKEN = process.env.SKUNKWORKS_KPI_TOKEN;

export const TZ = "America/Chicago";
export const CAPTURE_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

// Fetch the feed with a configurable budget. The synchronous entrypoint keeps
// this small so the whole function returns inside Netlify's ~10s wall even on a
// slow/hanging feed; the background entrypoint can afford to wait it out.
async function fetchFeed({ attempts, timeoutMs, backoffMs }) {
  let url;
  try {
    const u = new URL(KPI_URL);
    u.searchParams.delete("token");
    u.searchParams.set("token", KPI_TOKEN);
    url = u.toString();
  } catch {
    return { error: "SKUNKWORKS_KPI_URL is not a valid URL" };
  }
  let lastErr = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) { lastErr = `responded ${res.status}: ${text.slice(0, 150)}`; }
      else {
        try { return { payload: JSON.parse(text) }; }
        catch { lastErr = `non-JSON: ${text.slice(0, 120).replace(/\s+/g, " ")}`; }
      }
    } catch (e) {
      lastErr = e?.name === "AbortError" ? "timed out" : (e?.message || String(e));
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts && backoffMs) await new Promise((r) => setTimeout(r, attempt * backoffMs));
  }
  return { error: lastErr || "feed unavailable" };
}

// Run one capture. Returns { statusCode, body, ok, businessDate, laborStored }.
// opts.source labels the pull-log row ("cron" | "cron-bg" | "manual" | ...).
// opts.fetch = { attempts, timeoutMs, backoffMs } is the feed-fetch budget.
// opts.runRanker (default true) gates the week-end auto-advance; the sync path
// can disable it to stay well under the HTTP wall.
export async function runKpiCapture(supa, opts = {}) {
  const {
    wc = wallClockInTz(new Date(), TZ),
    source = "cron",
    fetch: fetchBudget = { attempts: 3, timeoutMs: 20000, backoffMs: 2000 },
    runRanker = true,
  } = opts;

  const started = Date.now();
  const centralDate = `${wc.year}-${String(wc.month).padStart(2, "0")}-${String(wc.day).padStart(2, "0")}`;

  if (!KPI_URL || !KPI_TOKEN) {
    return { statusCode: 200, ok: false, body: "kpi-capture not configured (env vars missing)" };
  }

  const { payload, error: feedErr } = await fetchFeed(fetchBudget);
  if (!payload) {
    // A slow / unavailable feed is expected during the morning fill-in window.
    // Log it and return a clean 200 "not ready" — the next poll (5-min catch-up
    // loop, or the 30-min puller) picks it up. Returning non-2xx here is what
    // used to surface as a red workflow run for a transient feed hiccup.
    console.log(`[kpi-capture:${source}] feed not ready: ${feedErr}`);
    await logPull(supa, { source, ok: false, central_date: centralDate, central_hour: wc.hour, error: feedErr, duration_ms: Date.now() - started });
    return { statusCode: 200, ok: false, feedNotReady: true, body: `feed not ready (${feedErr}) — will retry next poll` };
  }

  // Store the raw snapshot (retry a couple times for a transient Supabase blip).
  let snapErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supa
      .from("kpi_snapshots")
      .upsert(
        { captured_at: new Date().toISOString(), central_date: centralDate, central_hour: wc.hour, payload },
        { onConflict: "central_date,central_hour" },
      );
    if (!error) { snapErr = null; break; }
    snapErr = error;
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
  }
  if (snapErr) {
    console.log(`[kpi-capture:${source}] kpi_snapshots insert failed after retries: ${snapErr.message}`);
    await logPull(supa, { source, ok: false, central_date: centralDate, central_hour: wc.hour, error: `kpi_snapshots insert failed: ${snapErr.message}`, duration_ms: Date.now() - started });
    return { statusCode: 500, ok: false, body: `DB insert failed: ${snapErr.message}` };
  }

  // Fan store-level labor into labor_v2_daily (per store + the feed's business
  // date), with migration-aware fallbacks so a not-yet-applied column set still
  // lands the rest.
  let laborStored = 0;
  const businessDate = feedBusinessDate(payload, wc);
  const extracted = extractLaborRows(payload);
  const laborRows = extracted.map((r) => ({ ...r, business_date: businessDate, captured_at: new Date().toISOString() }));
  if (laborRows.length) {
    let { error: lerr } = await supa.from("labor_v2_daily").upsert(laborRows, { onConflict: "store_number,business_date" });
    if (lerr && isPreHoursError(lerr)) {
      ({ error: lerr } = await supa.from("labor_v2_daily").upsert(stripHoursCols(laborRows), { onConflict: "store_number,business_date" }));
    }
    if (lerr && isPreMixError(lerr)) {
      ({ error: lerr } = await supa.from("labor_v2_daily").upsert(stripHoursCols(stripMixCols(laborRows)), { onConflict: "store_number,business_date" }));
    }
    if (lerr && isPre0272Error(lerr)) {
      ({ error: lerr } = await supa.from("labor_v2_daily").upsert(stripHoursCols(stripMixCols(stripTicketCols(laborRows))), { onConflict: "store_number,business_date" }));
    }
    if (lerr && isPre0238Error(lerr)) {
      ({ error: lerr } = await supa.from("labor_v2_daily").upsert(stripHoursCols(stripMixCols(stripRankingCols(stripTicketCols(laborRows)))), { onConflict: "store_number,business_date" }));
    }
    if (lerr) console.log(`[kpi-capture:${source}] labor upsert failed: ${lerr.message}`);
    else laborStored = laborRows.length;
  }

  // Fan per-store daily COUNT scores into count_daily (same feed + business date).
  let countStored = 0;
  const countRows = extractCountRows(payload).map((r) => ({
    ...r, business_date: businessDate, captured_at: new Date().toISOString(),
  }));
  if (countRows.length) {
    let { error: cerr } = await supa.from("count_daily").upsert(countRows, { onConflict: "store_number,business_date" });
    if (cerr && isPreCountExtrasError(cerr)) {
      ({ error: cerr } = await supa.from("count_daily").upsert(stripCountExtras(countRows), { onConflict: "store_number,business_date" }));
    }
    if (cerr) console.log(`[kpi-capture:${source}] count upsert failed: ${cerr.message}`);
    else countStored = countRows.length;
  }

  // Snapshot week/period closes when the captured day closes a fiscal week/period.
  let closes = { weeks: 0, periods: 0 };
  try { closes = await upsertLaborCloses(supa, extracted, businessDate); }
  catch (e) { console.log(`[kpi-capture:${source}] close snapshot failed: ${e.message}`); }

  // Auto-advance the Ranker on a week-ending Sunday (best-effort, once per week).
  let ranked = null;
  if (runRanker) {
    try {
      const fx = fiscalForDate(businessDate);
      if (fx && fx.isWeekEnd) {
        const { data: existing } = await supa
          .from("ranking_runs").select("id")
          .eq("week_ending", businessDate).eq("status", "complete").limit(1);
        if (existing && existing.length) {
          ranked = `week ${businessDate} already ranked`;
        } else {
          const r = await runRankingNow(supa, { id: null }, { weekEnding: businessDate });
          ranked = r?.error ? `run error: ${r.error}` : `auto-ran week ${r.week_ending} (${r.rows} rows)`;
        }
      }
    } catch (e) {
      ranked = `run error: ${e.message}`;
    }
    if (ranked) console.log(`[kpi-capture:${source}] ranker: ${ranked}`);
  }

  await logPull(supa, {
    source, ok: true, business_date: businessDate, store_rows: laborStored,
    wtd_rows: extracted.filter((r) => r.wtd_net_sales != null).length,
    ptd_rows: extracted.filter((r) => r.ptd_net_sales != null).length,
    kpi_snapshot: true, central_date: centralDate, central_hour: wc.hour, duration_ms: Date.now() - started,
  });
  console.log(`[kpi-capture:${source}] stored snapshot for ${centralDate} ${wc.hour}:00 CT · labor rows ${laborStored} · count rows ${countStored} (${businessDate}) · closes w${closes.weeks}/p${closes.periods}`);
  await pingHeartbeat("kpi");
  return {
    statusCode: 200, ok: true, businessDate, laborStored, countStored, closes, ranked,
    body: `captured ${centralDate} ${wc.hour}:00 CT · labor ${laborStored} · count ${countStored} rows for ${businessDate} · closes ${closes.weeks}w/${closes.periods}p${ranked ? ` · ranker: ${ranked}` : ""}`,
  };
}
