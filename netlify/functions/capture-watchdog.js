// capture-watchdog — internal health check for the KPI / Labor v2 feed capture.
//
// The dead-man's-switch in _lib/heartbeat.js catches TOTAL silence from outside
// our infra. This is the complementary inside view: it reads the pull log and
// the actual data, so it catches the "it ran but the data is wrong or missing"
// failures the heartbeat can't see — most importantly the exact case that lost
// 2026-08-26: by evening, yesterday's business date still had zero rows.
//
// Three checks (all Central-time, all tunable via env):
//   1. HEARTBEAT GAP  — inside the capture window (7am–10pm), no successful
//      pull in the last CAPTURE_ALERT_GAP_MIN minutes.
//   2. MISSING DAY    — after CAPTURE_EXPECT_YESTERDAY_HOUR, yesterday's
//      business_date (which today's captures should have pulled, given the
//      feed's ~1-day lag) still has 0 rows in labor_v2_daily.
//   3. CONSECUTIVE FAIL — the last CAPTURE_ALERT_FAIL_STREAK cron pulls all
//      failed with no success between them.
//
// On any fresh incident it emails CAPTURE_ALERT_TO via Resend. Alerts dedup on
// a CAPTURE_ALERT_COOLDOWN_MIN window using marker rows written back into
// kpi_pull_log (source='watchdog-alert'), so a standing outage pings once, not
// every run. Healthy → 200 and silence.
//
//   ?dry=1   run the checks and report incidents WITHOUT emailing / marking
//   ?test=1  send a wiring-test email immediately, ignoring window + cooldown
//
// Env (all optional; sane defaults):
//   CAPTURE_ALERT_TO                 recipient(s), comma-separated (default
//                                    info@heathkelley.com)
//   CAPTURE_ALERT_GAP_MIN            heartbeat-gap threshold (default 180)
//   CAPTURE_ALERT_COOLDOWN_MIN       per-incident alert cooldown (default 360)
//   CAPTURE_ALERT_FAIL_STREAK        consecutive failures to alert on (default 3)
//   CAPTURE_EXPECT_YESTERDAY_HOUR    Central hour to expect yesterday's data
//                                    to have landed (default 18)
//   RESEND_API_KEY / RESEND_FROM_*   shared with the rest of the app

import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./_lib/ticketEmail.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const TZ = "America/Chicago";
const WINDOW_START_MIN = 7 * 60;   // 7:00 AM CT — capture window opens
const WINDOW_END_MIN = 22 * 60;    // 10:00 PM CT — capture window closes

const GAP_MIN = intEnv(process.env.CAPTURE_ALERT_GAP_MIN, 180);
const COOLDOWN_MIN = intEnv(process.env.CAPTURE_ALERT_COOLDOWN_MIN, 360);
const FAIL_STREAK = intEnv(process.env.CAPTURE_ALERT_FAIL_STREAK, 3);
const EXPECT_HOUR = intEnv(process.env.CAPTURE_EXPECT_YESTERDAY_HOUR, 18);

function intEnv(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function recipients() {
  const raw = process.env.CAPTURE_ALERT_TO || "info@heathkelley.com";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Wall-clock parts in TZ (DST-safe) — mirrors kpi-capture's helper.
function wallClockInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utcDate);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return { year: +get("year"), month: +get("month"), day: +get("day"), hour, minute: +get("minute") };
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Yesterday's date string, relative to the given Central wall-clock day.
function yesterdayIso(wc) {
  const t = new Date(Date.UTC(wc.year, wc.month - 1, wc.day) - 86400000);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const minutesAgo = (isoTs, nowMs) => Math.round((nowMs - new Date(isoTs).getTime()) / 60000);

export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 200, body: "capture-watchdog not configured (env vars missing)" };
  }
  const dry = event?.queryStringParameters?.dry === "1";
  const test = event?.queryStringParameters?.test === "1";
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const nowMs = Date.now();
  const wc = wallClockInTz(new Date(), TZ);
  const nowMin = wc.hour * 60 + wc.minute;
  const todayCentral = iso(wc.year, wc.month, wc.day);
  const yesterday = yesterdayIso(wc);

  // Wiring test — send immediately, bypass all gating.
  if (test) {
    const r = await sendEmail({
      to: recipients(),
      subject: "SOAR capture watchdog — test alert",
      html: `<p>This is a <strong>test</strong> from capture-watchdog at ${todayCentral} ${String(wc.hour).padStart(2, "0")}:${String(wc.minute).padStart(2, "0")} CT.</p><p>If you received this, alert delivery is wired correctly.</p>`,
    });
    return { statusCode: 200, body: `test email → ${JSON.stringify(r)}` };
  }

  const incidents = [];

  // ── Check 1: heartbeat gap (only meaningful once enough of the window has
  // elapsed to expect a capture, and only inside the window). ───────────────
  const inWindow = nowMin >= WINDOW_START_MIN && nowMin <= WINDOW_END_MIN;
  if (inWindow && nowMin - WINDOW_START_MIN >= GAP_MIN) {
    const { data: lastOk } = await supa
      .from("kpi_pull_log").select("created_at")
      .eq("ok", true).order("created_at", { ascending: false }).limit(1);
    const last = lastOk?.[0]?.created_at;
    const age = last ? minutesAgo(last, nowMs) : null;
    if (!last || age > GAP_MIN) {
      incidents.push({
        kind: "heartbeat-gap",
        detail: last
          ? `No successful capture in ${age} min (threshold ${GAP_MIN}). Last success ${last}.`
          : `No successful capture on record at all (threshold ${GAP_MIN} min).`,
      });
    }
  }

  // ── Check 2: yesterday's business date missing (the 2026-08-26 case). ──────
  if (wc.hour >= EXPECT_HOUR) {
    const { count, error } = await supa
      .from("labor_v2_daily").select("store_number", { count: "exact", head: true })
      .eq("business_date", yesterday);
    if (!error && (count ?? 0) === 0) {
      incidents.push({
        kind: "missing-day",
        detail: `labor_v2_daily has 0 rows for business_date ${yesterday}. Today's captures should have pulled it (feed lags ~1 day). It cannot be back-pulled once the feed rolls forward.`,
      });
    }
  }

  // ── Check 3: consecutive failed pulls. ────────────────────────────────────
  {
    const { data: recent } = await supa
      .from("kpi_pull_log").select("ok, created_at, error, central_hour")
      .eq("source", "cron").order("created_at", { ascending: false }).limit(FAIL_STREAK);
    if (recent && recent.length >= FAIL_STREAK && recent.every((r) => r.ok === false)) {
      const lastErr = recent[0]?.error || "unknown";
      incidents.push({
        kind: "consecutive-fail",
        detail: `Last ${FAIL_STREAK} scheduled pulls all failed. Most recent error: ${lastErr}`,
      });
    }
  }

  if (!incidents.length) {
    return { statusCode: 200, body: `healthy — ${todayCentral} ${wc.hour}:00 CT (in-window: ${inWindow})` };
  }

  // Dedup: drop incidents we already alerted on within the cooldown.
  const cutoff = new Date(nowMs - COOLDOWN_MIN * 60000).toISOString();
  const { data: recentAlerts } = await supa
    .from("kpi_pull_log").select("error, created_at")
    .eq("source", "watchdog-alert").gte("created_at", cutoff);
  const alertedKinds = new Set((recentAlerts || []).map((r) => String(r.error || "").split(":")[0]));
  const fresh = incidents.filter((i) => !alertedKinds.has(i.kind));

  if (!fresh.length) {
    return { statusCode: 200, body: `${incidents.length} incident(s), all within cooldown — no email sent` };
  }

  if (dry) {
    return { statusCode: 200, body: `DRY — would alert on: ${fresh.map((i) => i.kind).join(", ")}` };
  }

  // Send one combined email covering the fresh incidents.
  const rows = fresh
    .map((i) => `<li><strong>${i.kind}</strong> — ${i.detail}</li>`)
    .join("");
  const html = `
    <p>The KPI / Labor v2 capture watchdog flagged a problem at
       <strong>${todayCentral} ${String(wc.hour).padStart(2, "0")}:${String(wc.minute).padStart(2, "0")} CT</strong>.</p>
    <ul>${rows}</ul>
    <p><strong>What to check:</strong></p>
    <ul>
      <li>Admin → Labor Sync — set the date picker to <strong>${yesterday}</strong> and confirm rows are present.</li>
      <li>Admin → the KPI pull log for recent failures / gaps.</li>
      <li>If a scheduled trigger stalled, a manual run (kpi-capture / labor-snapshot, or the GitHub "Run workflow" button) captures the current snapshot.</li>
    </ul>
    <p style="color:#666;font-size:12px">Thresholds: gap ${GAP_MIN}m · fail-streak ${FAIL_STREAK} · expect-yesterday-by ${EXPECT_HOUR}:00 CT · cooldown ${COOLDOWN_MIN}m. Tune via the CAPTURE_ALERT_* env vars.</p>`;

  const sendResult = await sendEmail({
    to: recipients(),
    subject: `⚠ SOAR capture issue: ${fresh.map((i) => i.kind).join(", ")}`,
    html,
  });

  // Write a marker per fresh incident so the next run dedups on the cooldown.
  const markers = fresh.map((i) => ({
    source: "watchdog-alert",
    ok: false,
    error: `${i.kind}: ${i.detail}`.slice(0, 500),
    central_date: todayCentral,
    central_hour: wc.hour,
    created_at: new Date().toISOString(),
  }));
  try {
    await supa.from("kpi_pull_log").insert(markers);
  } catch (e) {
    console.log(`[capture-watchdog] marker insert failed: ${e?.message || e}`);
  }

  console.log(`[capture-watchdog] alerted: ${fresh.map((i) => i.kind).join(", ")} → ${JSON.stringify(sendResult)}`);
  return { statusCode: 200, body: `alerted on ${fresh.map((i) => i.kind).join(", ")} → sent=${sendResult?.sent}` };
};

// Backup Netlify trigger (native cron is unreliable in this project — see
// kpi-capture.js). The GitHub Actions workflow capture-watchdog.yml is the
// reliable one. Fire a few times across the afternoon/evening Central so the
// heartbeat-gap and missing-day checks get a look each day; the cooldown keeps
// a standing outage to one alert. UTC hours span ~1pm–11pm CT across DST.
export const config = {
  schedule: "0 18-23,0-5 * * *",
};
