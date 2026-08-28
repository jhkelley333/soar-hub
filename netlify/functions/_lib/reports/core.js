// Report engine — shared core. Service-role Supabase client, Resend sender,
// timezone-aware cron matching, settings read/write, and recipient resolution.
// Used by the dispatcher (netlify/functions/reports-dispatcher.js) and the
// admin API (netlify/functions/reports.js).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Resend contract — identical env vars to paf.js / training-credit-digest.js.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || "SOAR Hub";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || null;

export function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("report engine: Supabase env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function envConfigured() {
  return !!(SUPABASE_URL && SERVICE_KEY);
}

// ── Resend ───────────────────────────────────────────────────────────────────
// Sends one email to a de-duped recipient list. Returns { ok } / { skipped } /
// { ok:false, status }. Never throws — the caller records the run either way.
export async function sendEmail({ to, subject, text, html, attachments }) {
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean).map((e) => String(e).trim().toLowerCase()))];
  if (!recipients.length) return { skipped: true, reason: "no recipients" };
  if (!RESEND_API_KEY) return { skipped: true, reason: "RESEND_API_KEY not set" };
  // Resend attachments: [{ filename, content: <base64 string> }].
  const files = Array.isArray(attachments) ? attachments.filter((a) => a?.filename && a?.content) : [];
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: recipients,
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
        ...(files.length ? { attachments: files } : {}),
        ...(RESEND_REPLY_TO ? { reply_to: RESEND_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, status: res.status, detail: String(detail).slice(0, 300) };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id ?? null, count: recipients.length };
  } catch (e) {
    return { ok: false, status: 0, detail: e?.message || String(e) };
  }
}

// ── Timezone / cron ──────────────────────────────────────────────────────────
// Wall-clock parts (DST-safe) for a UTC instant in a timezone. Mirrors the
// Intl approach used by the existing scheduled digests.
export function wallClock(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: +get("year"), month: +get("month"), day: +get("day"),
    hour, minute: parseInt(get("minute"), 10), dow: WD[get("weekday")] ?? 0,
  };
}

// Match one cron field (minute/hour/dom/month/dow) against a value. Supports
// "*", "*/n", "a-b", comma lists, and single numbers.
function fieldMatches(field, value) {
  if (field === "*" || field === "?") return true;
  for (const part of String(field).split(",")) {
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      if (!step) continue;
      if (range === "*" ) { if (value % step === 0) return true; continue; }
      const [lo, hi] = range.split("-").map((n) => parseInt(n, 10));
      if (Number.isFinite(lo)) { const top = Number.isFinite(hi) ? hi : lo; if (value >= lo && value <= top && (value - lo) % step === 0) return true; }
      continue;
    }
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map((n) => parseInt(n, 10));
      if (Number.isFinite(lo) && Number.isFinite(hi) && value >= lo && value <= hi) return true;
      continue;
    }
    if (parseInt(part, 10) === value) return true;
  }
  return false;
}

// Does a 5-field cron (min hour dom month dow) fire at this wall-clock minute?
export function cronMatches(cron, wall) {
  const f = String(cron || "").trim().split(/\s+/);
  if (f.length !== 5) return false;
  const [min, hr, dom, mon, dow] = f;
  return (
    fieldMatches(min, wall.minute) &&
    fieldMatches(hr, wall.hour) &&
    fieldMatches(dom, wall.day) &&
    fieldMatches(mon, wall.month) &&
    fieldMatches(dow, wall.dow)
  );
}

// The most recent minute in [now - lookbackMin, now] at which `cron` fires in
// `tz`, or null. window_start for the dispatcher's idempotency claim. Returns a
// Date truncated to the minute (seconds/ms zeroed) so the claim key is stable.
export function lastFireWithin(cron, tz, now, lookbackMin) {
  for (let back = 0; back <= lookbackMin; back++) {
    const t = new Date(now.getTime() - back * 60_000);
    if (cronMatches(cron, wallClock(t, tz))) {
      const m = new Date(t);
      m.setUTCSeconds(0, 0);
      return m;
    }
  }
  return null;
}

// ── Settings ─────────────────────────────────────────────────────────────────
export async function getSetting(supa, key, fallback = null) {
  const { data } = await supa.from("system_settings").select("value").eq("key", key).maybeSingle();
  return data ? data.value : fallback;
}

// ── Recipient resolution ─────────────────────────────────────────────────────
// recipients: [{mode:'static', value:'a@b.com' | 'a@b.com,c@d.com'},
//              {mode:'role', value:'coo'}]  → a de-duped lowercase email list.
// Role mode resolves to every ACTIVE profile with that role. Per-user
// role-relative resolution (e.g. "each user's own RVP") is report-specific and
// handled inside that report's handler, not here.
export async function resolveRecipients(supa, recipients) {
  const list = Array.isArray(recipients) ? recipients : [];
  const emails = new Set();
  const roles = [];
  for (const r of list) {
    if (!r) continue;
    if (r.mode === "static" && r.value) {
      for (const e of String(r.value).split(/[,\s;]+/)) if (e.includes("@")) emails.add(e.trim().toLowerCase());
    } else if (r.mode === "role" && r.value) {
      roles.push(String(r.value).toLowerCase());
    }
  }
  if (roles.length) {
    const { data } = await supa.from("profiles").select("email, role, is_active").in("role", roles);
    for (const p of data || []) if (p.is_active !== false && p.email) emails.add(String(p.email).trim().toLowerCase());
  }
  return [...emails];
}
