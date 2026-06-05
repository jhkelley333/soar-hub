// netlify/functions/walkthrough-overdue-digest.js
//
// Netlify Scheduled Function — daily "you have overdue walkthrough items"
// reminder. Every day at 7:00 AM US Central we email each person who has:
//   * overdue walkthrough assignments (due_at < now, not yet submitted), and/or
//   * overdue corrective actions they own (due_at < now, not closed).
// One digest per recipient; people with nothing overdue get no email.
//
// Timezone: Netlify cron is UTC and not DST-aware, so we fire at both
// candidate UTC hours (12:00 / 13:00) daily and only proceed when the wall
// clock in America/Chicago is 07:00 — same approach as
// training-credit-digest.js / workspace-schedules-sweep.js.
//
// Manual / test invocation (HTTP GET):
//   ?force=1   bypass the 07:00-Central time guard
//   ?dry=1     compute the digests but send nothing
//
// Service-role reads (RLS bypassed) so we see every scope; the digest only
// ever goes to the assignee/owner of their own items.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SEND_TZ = "America/Chicago";
const SEND_HOUR = 7;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || "SOAR Walkthroughs";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || null;
const APP_URL = process.env.APP_URL || process.env.URL || "https://app.mysoarhub.com";

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function wallClockInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utcDate);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return { hour };
}

function personName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "there";
}
function daysOverdue(dueAt) {
  return Math.max(0, Math.floor((Date.now() - new Date(dueAt).getTime()) / 86_400_000));
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function sendEmailViaResend({ to, subject, text }) {
  if (!to) return { skipped: true };
  if (!RESEND_API_KEY) {
    console.warn("[walkthrough-overdue-digest] RESEND_API_KEY not set; skipping", { subject });
    return { skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: [to],
        subject,
        text,
        ...(RESEND_REPLY_TO ? { reply_to: RESEND_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      console.warn("[walkthrough-overdue-digest] Resend failed", res.status, await res.text().catch(() => ""));
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[walkthrough-overdue-digest] Resend threw", e?.message || e);
    return { ok: false, error: e?.message };
  }
}

export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[walkthrough-overdue-digest] missing Supabase env; aborting.");
    return { statusCode: 500, body: "missing env" };
  }

  const params = event?.queryStringParameters || {};
  const force = params.force === "1" || params.force === "true";
  const dry = params.dry === "1" || params.dry === "true";

  const { hour } = wallClockInTz(new Date(), SEND_TZ);
  if (!force && hour !== SEND_HOUR) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: "outside send window", hour }) };
  }

  const supa = admin();
  const nowIso = new Date().toISOString();

  const [asgRes, caRes] = await Promise.all([
    supa
      .from("walkthrough_assignments")
      .select("id, due_at, store:stores(number, name), template:walkthrough_templates(name), assignee:profiles!assignee_id(id, email, full_name, preferred_name)")
      .lt("due_at", nowIso)
      .neq("status", "submitted")
      .not("assignee_id", "is", null),
    supa
      .from("corrective_actions")
      .select("id, title, due_at, store:stores(number, name), owner:profiles!owner_id(id, email, full_name, preferred_name)")
      .lt("due_at", nowIso)
      .in("status", ["open", "in_progress", "verified"]),
  ]);
  if (asgRes.error) return { statusCode: 500, body: asgRes.error.message };
  if (caRes.error) return { statusCode: 500, body: caRes.error.message };

  // Group by recipient.
  const byPerson = new Map(); // id -> { person, walks:[], actions:[] }
  const bucket = (p) => {
    if (!p?.id || !p.email) return null;
    if (!byPerson.has(p.id)) byPerson.set(p.id, { person: p, walks: [], actions: [] });
    return byPerson.get(p.id);
  };
  for (const a of asgRes.data || []) {
    const b = bucket(a.assignee);
    if (b) b.walks.push(a);
  }
  for (const c of caRes.data || []) {
    const b = bucket(c.owner);
    if (b) b.actions.push(c);
  }

  const summary = { recipients: byPerson.size, sent: 0, skipped: 0, dry, details: [] };

  for (const { person, walks, actions } of byPerson.values()) {
    const lines = [`Hi ${personName(person)},`, "", "You have overdue store walkthrough items:"];
    if (walks.length) {
      lines.push("", `Walkthroughs (${walks.length}):`);
      for (const w of walks) {
        const store = w.store ? `Store #${w.store.number}` : "a store";
        lines.push(`  • ${store} — ${w.template?.name || "Walkthrough"} — due ${fmtDate(w.due_at)} (${daysOverdue(w.due_at)}d overdue)`);
      }
    }
    if (actions.length) {
      lines.push("", `Corrective actions (${actions.length}):`);
      for (const c of actions) {
        const store = c.store ? `Store #${c.store.number}` : "";
        lines.push(`  • ${c.title}${store ? ` @ ${store}` : ""} — due ${fmtDate(c.due_at)} (${daysOverdue(c.due_at)}d overdue)`);
      }
    }
    lines.push("", `Open My Walks: ${APP_URL}/my-walks`);
    const text = lines.join("\n");
    const total = walks.length + actions.length;
    const subject = `You have ${total} overdue walkthrough item${total === 1 ? "" : "s"}`;

    summary.details.push({ to: person.email, walks: walks.length, actions: actions.length });
    if (dry) { summary.skipped++; continue; }
    const r = await sendEmailViaResend({ to: person.email, subject, text });
    if (r.ok) summary.sent++; else summary.skipped++;
  }

  console.log("[walkthrough-overdue-digest]", JSON.stringify({ recipients: summary.recipients, sent: summary.sent, dry }));
  return { statusCode: 200, body: JSON.stringify(summary) };
};

// Daily at 12:00 and 13:00 UTC; the handler proceeds only at 07:00 Central.
export const config = {
  schedule: "0 12,13 * * *",
};
