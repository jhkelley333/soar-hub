// kpi-capture — scheduled puller for the Expressway KPI feed.
//
// Captures the raw feed into kpi_snapshots, and fans store-level labor into
// labor_v2_daily, hourly from 7 AM to 2 PM Central — the same "back office
// fills it in gradually through the morning" window labor-snapshot.js already
// uses for the Labor sheet. The feed doesn't have one "done" moment either
// (Expressway sometimes finishes after the old 7/9/11 AM-only window), so
// this widens the capture range and relies on idempotent upserts —
// kpi_snapshots keys on (central_date, central_hour) so each hour gets its
// own row, and labor_v2_daily keys on (store_number, business_date) so later
// hours converge it to the final numbers as the day's data lands. Previously
// this was admins manually checking the KPI Dashboard until the feed looked
// complete, then hitting "Refresh" on Labor v2 to pull it in — that dance is
// what this widened window + the GitHub Actions trigger below replace.
//
// Netlify's native scheduled-function trigger has been unreliable in this
// project before (see .github/workflows/labor-auto-pull.yml, which moved
// labor-snapshot off it for the same reason) — kept here as a backup, with
// .github/workflows/kpi-capture-pull.yml as the reliable trigger. Both are
// safe to fire redundantly: the function gates non-force calls to
// CAPTURE_HOURS and every write is an upsert.
//
// Netlify cron is UTC-only, so the config.schedule below fires on the union
// of UTC hours that can map to 7 AM–2 PM Central across DST, and this file
// gates on the actual America/Chicago hour (so it's always 7 AM–2 PM local,
// summer or winter).
//
// Manual test: GET /.netlify/functions/kpi-capture?force=1 captures now,
// regardless of the hour.

import { createClient } from "@supabase/supabase-js";
import { extractLaborRows, feedBusinessDate } from "./_lib/kpiLabor.js";
import { extractCountRows } from "./_lib/kpiCount.js";
import { upsertLaborCloses } from "./_lib/laborCloses.js";
import { logPull } from "./_lib/pullLog.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KPI_URL = process.env.SKUNKWORKS_KPI_URL;
const KPI_TOKEN = process.env.SKUNKWORKS_KPI_TOKEN;

const TZ = "America/Chicago";
const CAPTURE_HOURS = [7, 8, 9, 10, 11, 12, 13, 14];

// Wall-clock parts in a timezone (DST-safe). Mirrors the digest functions.
function wallClockInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utcDate);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return { year: +get("year"), month: +get("month"), day: +get("day"), hour };
}

export const handler = async (event) => {
  const force = event?.queryStringParameters?.force === "1";
  const wc = wallClockInTz(new Date(), TZ);

  if (!force && !CAPTURE_HOURS.includes(wc.hour)) {
    return { statusCode: 200, body: `skip — ${wc.hour}:00 CT is not a capture hour` };
  }
  const started = Date.now();
  const centralDate = `${wc.year}-${String(wc.month).padStart(2, "0")}-${String(wc.day).padStart(2, "0")}`;
  if (!KPI_URL || !KPI_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 200, body: "kpi-capture not configured (env vars missing)" };
  }

  // Build the URL: strip any token already on the env URL, then set ours.
  let url;
  try {
    const u = new URL(KPI_URL);
    u.searchParams.delete("token");
    u.searchParams.set("token", KPI_TOKEN);
    url = u.toString();
  } catch {
    return { statusCode: 500, body: "SKUNKWORKS_KPI_URL is not a valid URL" };
  }

  // Fetch the feed with a few retries — the feed occasionally returns a
  // non-JSON error page / 5xx, and a single blip shouldn't skip the capture.
  let payload;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) { lastErr = `responded ${res.status}: ${text.slice(0, 150)}`; }
      else { try { payload = JSON.parse(text); break; } catch { lastErr = `non-JSON: ${text.slice(0, 120).replace(/\s+/g, " ")}`; } }
    } catch (e) {
      lastErr = e?.name === "AbortError" ? "timed out" : (e?.message || String(e));
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000)); // 2s, 4s backoff
  }
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!payload) {
    console.log(`[kpi-capture] feed failed after retries: ${lastErr}`);
    await logPull(supa, { source: "cron", ok: false, central_date: centralDate, central_hour: wc.hour, error: lastErr, duration_ms: Date.now() - started });
    return { statusCode: 502, body: `Couldn't reach the KPI feed after retries: ${lastErr}` };
  }

  const { error } = await supa
    .from("kpi_snapshots")
    .upsert(
      { captured_at: new Date().toISOString(), central_date: centralDate, central_hour: wc.hour, payload },
      { onConflict: "central_date,central_hour" },
    );
  if (error) return { statusCode: 500, body: `DB insert failed: ${error.message}` };

  // Also fan the store-level labor numbers into labor_v2_daily (per store + the
  // feed's business date), so Labor v2 has its history without a separate fetch.
  let laborStored = 0;
  const businessDate = feedBusinessDate(payload, wc);
  const extracted = extractLaborRows(payload);
  const laborRows = extracted.map((r) => ({ ...r, business_date: businessDate, captured_at: new Date().toISOString() }));
  if (laborRows.length) {
    const { error: lerr } = await supa.from("labor_v2_daily").upsert(laborRows, { onConflict: "store_number,business_date" });
    if (lerr) console.log(`[kpi-capture] labor upsert failed: ${lerr.message}`);
    else laborStored = laborRows.length;
  }

  // Also fan the per-store daily COUNT scores into count_daily (same feed,
  // same business date) so the Daily Count page has trend history.
  let countStored = 0;
  const countRows = extractCountRows(payload).map((r) => ({
    ...r, business_date: businessDate, captured_at: new Date().toISOString(),
  }));
  if (countRows.length) {
    const { error: cerr } = await supa.from("count_daily").upsert(countRows, { onConflict: "store_number,business_date" });
    if (cerr) console.log(`[kpi-capture] count upsert failed: ${cerr.message}`);
    else countStored = countRows.length;
  }

  // When the captured day closes a fiscal week / period, snapshot the final
  // WTD / PTD into the close ledgers (idempotent upsert).
  let closes = { weeks: 0, periods: 0 };
  try { closes = await upsertLaborCloses(supa, extracted, businessDate); }
  catch (e) { console.log(`[kpi-capture] close snapshot failed: ${e.message}`); }

  await logPull(supa, {
    source: "cron", ok: true, business_date: businessDate, store_rows: laborStored,
    wtd_rows: extracted.filter((r) => r.wtd_net_sales != null).length,
    ptd_rows: extracted.filter((r) => r.ptd_net_sales != null).length,
    kpi_snapshot: true, central_date: centralDate, central_hour: wc.hour, duration_ms: Date.now() - started,
  });
  console.log(`[kpi-capture] stored snapshot for ${centralDate} ${wc.hour}:00 CT · labor rows ${laborStored} · count rows ${countStored} (${businessDate}) · closes w${closes.weeks}/p${closes.periods}`);
  return { statusCode: 200, body: `captured ${centralDate} ${wc.hour}:00 CT · labor ${laborStored} · count ${countStored} rows for ${businessDate} · closes ${closes.weeks}w/${closes.periods}p` };
};

// Fire on every UTC hour that could be 7 AM–2 PM Central (CST or CDT); the
// handler gates to the real Central hour, so exactly eight captures land
// each day regardless of DST. Backup trigger only — see the file header and
// .github/workflows/kpi-capture-pull.yml for the reliable one.
export const config = {
  schedule: "0 12-20 * * *",
};
