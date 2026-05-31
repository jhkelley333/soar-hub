// netlify/functions/training-credit-digest.js
//
// Netlify Scheduled Function — weekly "close out your training credits"
// reminder to each DO.
//
// Every Monday at 7:00 AM US Central we email each DO a digest of the
// Training Credit Requests in their district that are still sitting at
// status 'On Weekly Sheet' and whose training finished in the week that
// just ended (last_day_date within the previous Mon–Sun). Those are the
// credits the DO still needs to close out. A DO with no such items gets
// no email.
//
// "Previous week" is anchored on `last_day_date` — the form's "Last
// Training Day", which exists specifically to time the DO's closeout
// (see migration 0092 / buildTrainingFields in employee-actions.js). To
// re-anchor on a different column, change WEEK_ANCHOR_COLUMN below.
//
// Timezone: Netlify cron is UTC and is NOT DST-aware, so we fire at both
// candidate UTC hours (12:00 and 13:00) every Monday and let the handler
// proceed only when the wall clock in America/Chicago is actually 07:00.
// That keeps the send at 7 AM Central across the CST↔CDT switch without
// any seasonal config change. (Same Intl-based TZ approach as
// workspace-schedules-sweep.js.)
//
// Manual / test invocation (HTTP GET to the function URL):
//   ?force=1         bypass the Monday-07:00-Central time guard
//   ?dry=1           compute + return the grouped digests but send nothing
//   ?weekOffset=N    target N weeks further back (default 1 = last week)
//
// Read/write goes through the service-role key, mirroring the rest of the
// Employee Actions backend (RLS is enabled with no policies).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SEND_TZ = "America/Chicago"; // Central — handles CST/CDT automatically
const SEND_HOUR = 7; // 7:00 AM local
const SEND_WEEKDAY = 1; // Monday (0=Sun … 6=Sat)
const TARGET_STATUS = "On Weekly Sheet";
const WEEK_ANCHOR_COLUMN = "last_day_date";

// Resend contract — identical env vars to employee-actions.js / paf.js.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME =
  process.env.EMPLOYEE_ACTIONS_FROM_NAME ||
  process.env.RESEND_FROM_NAME ||
  "SOAR Employee Actions";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || null;

// Google Form the DO completes to close out a finished training. Same
// default + override knob as employee-actions.js.
const CLOSEOUT_FORM_URL =
  process.env.TRAINING_CLOSEOUT_FORM_URL ||
  "https://docs.google.com/forms/d/e/1FAIpQLSeovlvWNQiJ2UDd5rlIqTkf7UEIVeZ88VkrJgdKUAd9Vso5Xw/viewform";

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function appBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
}

function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "";
}

// ── Timezone / week math ─────────────────────────────────────────────
// Wall-clock components in `tz` for a given UTC instant (mirrors the
// helper in workspace-schedules-sweep.js).
function wallClockInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).formatToParts(utcDate);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some engines emit 24 at midnight
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour,
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function ymd(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Given a calendar date (Y/M/D, no time), return its day-of-week with
// 0=Sun…6=Sat, plus helpers to shift by whole days. We treat the date as
// a pure calendar date via Date.UTC so no timezone skews the arithmetic.
function shiftYmd(year, month, day, deltaDays) {
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
    dow: base.getUTCDay(),
  };
}

// The most-recent complete Mon–Sun week, `weekOffset` weeks back from the
// week containing `today` (in Central). weekOffset=1 → last week.
function previousWeekRange(centralToday, weekOffset = 1) {
  const todayDow = new Date(
    Date.UTC(centralToday.year, centralToday.month - 1, centralToday.day)
  ).getUTCDay();
  const daysSinceMonday = (todayDow + 6) % 7; // Mon→0 … Sun→6
  const thisMonday = -daysSinceMonday;
  const start = shiftYmd(
    centralToday.year, centralToday.month, centralToday.day,
    thisMonday - 7 * weekOffset
  );
  const end = shiftYmd(start.year, start.month, start.day, 6);
  return {
    start: ymd(start.year, start.month, start.day),
    end: ymd(end.year, end.month, end.day),
  };
}

// ── Email ────────────────────────────────────────────────────────────
async function sendEmailViaResend({ to, subject, text }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : to ? [to] : [];
  if (!recipients.length) return { skipped: true };
  if (!RESEND_API_KEY) {
    console.warn("[training-credit-digest] RESEND_API_KEY not set; skipping send", { subject });
    return { skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: recipients,
        subject,
        text,
        ...(RESEND_REPLY_TO ? { reply_to: RESEND_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn("[training-credit-digest] Resend send failed", res.status, detail);
      return { ok: false, status: res.status };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id };
  } catch (e) {
    console.warn("[training-credit-digest] Resend send threw", e);
    return { ok: false, error: e?.message };
  }
}

// ── Store → DO resolution (mirrors employee-actions.js resolveStoreLeadership) ─
async function scopedProfiles(supa, scopeType, scopeId, role) {
  if (!scopeId) return [];
  const { data: candidates } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name")
    .eq("role", role)
    .eq("is_active", true);
  const byId = new Map((candidates ?? []).map((p) => [p.id, p]));
  if (!byId.size) return [];
  const { data: scoped } = await supa
    .from("user_scopes")
    .select("user_id")
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .in("user_id", Array.from(byId.keys()));
  const out = [];
  for (const s of scoped ?? []) {
    const p = byId.get(s.user_id);
    if (p) out.push(p);
  }
  return out;
}

// The DO(s) responsible for a store, via its district scope.
async function resolveStoreDOs(supa, storeNumber) {
  const { data: store } = await supa
    .from("stores")
    .select("id, district_id")
    .eq("number", storeNumber)
    .maybeSingle();
  if (!store?.district_id) return [];
  return scopedProfiles(supa, "district", store.district_id, "do");
}

// ── Digest composition ───────────────────────────────────────────────
function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function digestText(doName, range, items, storeNames) {
  const lines = items
    .map((r) => {
      const store = storeNames.get(String(r.store_number)) || `Store ${r.store_number}`;
      const type = r.training_other
        ? `${r.training_type} (${r.training_other})`
        : r.training_type;
      return `  • ${store} — ${r.employee_name}: ${type}, finished ${r.last_day_date} — ${money(r.requested_amount)}`;
    })
    .join("\n");
  const total = items.reduce((sum, r) => sum + (Number(r.requested_amount) || 0), 0);
  const link = appBaseUrl() ? `${appBaseUrl()}/employee-actions` : "the Employee Actions page";
  return (
    `Good morning${doName ? ` ${doName}` : ""},\n\n` +
    `You have ${items.length} training credit${items.length === 1 ? "" : "s"} from last week ` +
    `(${range.start} – ${range.end}) still on the weekly sheet and waiting to be closed out:\n\n` +
    `${lines}\n\n` +
    `Total: ${money(total)}\n\n` +
    `Close each one out using the training closeout form:\n${CLOSEOUT_FORM_URL}\n\n` +
    `You can also review them in SOAR Hub:\n${link}\n`
  );
}

// ── Handler ──────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[training-credit-digest] missing Supabase env vars; aborting.");
    return { statusCode: 500, body: "missing env" };
  }

  const params = event?.queryStringParameters || {};
  const force = params.force === "1" || params.force === "true";
  const dry = params.dry === "1" || params.dry === "true";
  const weekOffset = Math.max(1, parseInt(params.weekOffset, 10) || 1);

  const now = new Date();
  const central = wallClockInTz(now, SEND_TZ);
  const centralDow = new Date(
    Date.UTC(central.year, central.month - 1, central.day)
  ).getUTCDay();

  // Time guard: only the Monday-07:00-Central firing does real work; the
  // other candidate UTC hour bails. Skipped, not an error.
  if (!force && (central.hour !== SEND_HOUR || centralDow !== SEND_WEEKDAY)) {
    console.log(
      `[training-credit-digest] not 7AM Central Monday (got dow=${centralDow} hour=${central.hour}); skipping.`
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: "outside send window", central }),
    };
  }

  const supa = admin();
  const range = previousWeekRange(central, weekOffset);

  // Pull the in-scope training credits for the target week.
  const { data: rows, error } = await supa
    .from("training_credit_requests")
    .select(
      "id, store_number, employee_name, training_type, training_other, requested_amount, last_day_date, status"
    )
    .eq("status", TARGET_STATUS)
    .gte(WEEK_ANCHOR_COLUMN, range.start)
    .lte(WEEK_ANCHOR_COLUMN, range.end)
    .order("store_number", { ascending: true });
  if (error) {
    console.error("[training-credit-digest] query failed:", error.message);
    return { statusCode: 500, body: error.message };
  }

  const summary = {
    window: range,
    weekOffset,
    candidates: rows?.length || 0,
    dos_emailed: 0,
    sent: 0,
    skipped: 0,
    dry,
    details: [],
  };

  if (!rows?.length) {
    console.log(`[training-credit-digest] no '${TARGET_STATUS}' credits for ${range.start}–${range.end}.`);
    return { statusCode: 200, body: JSON.stringify(summary) };
  }

  // Store-number → name map for friendlier email lines.
  const distinctStores = Array.from(new Set(rows.map((r) => String(r.store_number)).filter(Boolean)));
  const storeNames = new Map();
  if (distinctStores.length) {
    const { data: storeRows } = await supa
      .from("stores")
      .select("number, name")
      .in("number", distinctStores);
    for (const s of storeRows ?? []) storeNames.set(String(s.number), s.name);
  }

  // Resolve each store's DO(s) once, then group rows by DO.
  const dosByStore = new Map();
  for (const store of distinctStores) {
    dosByStore.set(store, await resolveStoreDOs(supa, store));
  }

  // doEmail → { profile, items[] }
  const byDo = new Map();
  const orphanStores = new Set();
  for (const r of rows) {
    const dos = dosByStore.get(String(r.store_number)) || [];
    if (!dos.length) {
      orphanStores.add(String(r.store_number));
      continue;
    }
    for (const d of dos) {
      if (!d.email) continue;
      if (!byDo.has(d.email)) byDo.set(d.email, { profile: d, items: [] });
      byDo.get(d.email).items.push(r);
    }
  }
  if (orphanStores.size) {
    console.warn(
      `[training-credit-digest] no DO resolved for store(s): ${Array.from(orphanStores).join(", ")}`
    );
    summary.stores_without_do = Array.from(orphanStores);
  }

  for (const [email, { profile, items }] of byDo) {
    const subject = `${items.length} training credit${items.length === 1 ? "" : "s"} to close out — week of ${range.start}`;
    const text = digestText(displayName(profile), range, items, storeNames);
    summary.dos_emailed += 1;

    if (dry) {
      summary.details.push({ do: email, items: items.length, subject });
      continue;
    }
    const res = await sendEmailViaResend({ to: email, subject, text });
    if (res?.ok || res?.skipped) {
      if (res.ok) summary.sent += 1;
      else summary.skipped += 1;
    } else {
      summary.skipped += 1;
    }
    summary.details.push({ do: email, items: items.length, result: res });
  }

  console.log(
    `[training-credit-digest] window=${range.start}..${range.end} candidates=${summary.candidates}`
    + ` dos=${summary.dos_emailed} sent=${summary.sent} skipped=${summary.skipped} dry=${dry}`
  );
  return { statusCode: 200, body: JSON.stringify(summary) };
};

// Schedule config — Netlify reads this export. Mondays at 12:00 and 13:00
// UTC; the handler proceeds only at 07:00 America/Chicago (DST-safe).
export const config = {
  schedule: "0 12,13 * * 1",
};
