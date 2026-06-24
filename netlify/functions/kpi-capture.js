// kpi-capture — scheduled puller for the Expressway KPI feed.
//
// Captures the raw feed into kpi_snapshots at 7, 9, and 11 AM Central, daily.
// Netlify cron is UTC-only, so we fire on the union of UTC hours that can map to
// those Central times across DST and gate on the actual America/Chicago hour
// (so it's always 7/9/11 local, summer or winter). One row per date+hour
// (upsert), so a retry won't duplicate.
//
// Manual test: GET /.netlify/functions/kpi-capture?force=1 captures now,
// regardless of the hour.

import { createClient } from "@supabase/supabase-js";
import { extractLaborRows, feedBusinessDate } from "./_lib/kpiLabor.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KPI_URL = process.env.SKUNKWORKS_KPI_URL;
const KPI_TOKEN = process.env.SKUNKWORKS_KPI_TOKEN;

const TZ = "America/Chicago";
const CAPTURE_HOURS = [7, 9, 11];

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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let payload;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) return { statusCode: 502, body: `KPI feed responded ${res.status}: ${text.slice(0, 200)}` };
    payload = JSON.parse(text);
  } catch (e) {
    const msg = e?.name === "AbortError" ? "timed out" : (e?.message || String(e));
    return { statusCode: 502, body: `Couldn't reach the KPI feed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }

  const centralDate = `${wc.year}-${String(wc.month).padStart(2, "0")}-${String(wc.day).padStart(2, "0")}`;
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
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
  const laborRows = extractLaborRows(payload).map((r) => ({ ...r, business_date: businessDate, captured_at: new Date().toISOString() }));
  if (laborRows.length) {
    const { error: lerr } = await supa.from("labor_v2_daily").upsert(laborRows, { onConflict: "store_number,business_date" });
    if (lerr) console.log(`[kpi-capture] labor upsert failed: ${lerr.message}`);
    else laborStored = laborRows.length;
  }

  console.log(`[kpi-capture] stored snapshot for ${centralDate} ${wc.hour}:00 CT · labor rows ${laborStored} (${businessDate})`);
  return { statusCode: 200, body: `captured ${centralDate} ${wc.hour}:00 CT · labor ${laborStored} rows for ${businessDate}` };
};

// Fire on every UTC hour that could be 7/9/11 Central (CST or CDT); the handler
// gates to the real Central hour, so exactly three captures land each day.
export const config = {
  schedule: "0 12,13,14,15,16,17 * * *",
};
