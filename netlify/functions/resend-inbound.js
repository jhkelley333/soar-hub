// netlify/functions/resend-inbound.js
//
// Inbound webhook for Resend "email.received" events. A reply to a
// Request-More-Info email (sent with reply-to wo-<ticketId>@inbound...
// or wo-<ticketId>--<channel>@inbound... for per-channel threads) lands
// here. We:
//   1. verify the Svix signature (Resend signs webhooks via Svix),
//   2. parse the ticket id (and optional channel) out of the recipient,
//   3. pull the reply body via the Resend received-emails API
//      (the webhook payload is metadata-only),
//   4. post the reply into the work order's chat thread, and
//   5. clear the Needs-info flag so the approval clock resumes.
//
// The whole handler is wrapped so we ALWAYS return 200 to Resend once
// the signature is valid — that prevents a single bad event from putting
// Resend into a retry loop ("Attempting" forever). Real failures are
// logged via console.* so they're visible in Netlify Function logs.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// DB-allowed thread_types (see migration 0036 + 0079). "store" isn't
// allowed yet, so we map it to "requester" — the channel intent is
// captured in the activity payload + user_role tag so a follow-up
// migration can split them cleanly later without losing history.
const ALLOWED_THREAD_TYPES = new Set(["internal", "vendor", "requester"]);

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  };
}

// Email fields may come back as a string ("Name <a@b.com>") or an object
// ({ address, name }). Normalize to a plain address string.
function addrString(a) {
  if (!a) return "";
  if (typeof a === "string") return a;
  return a.address || a.email || a.name || "";
}

// Svix HMAC verification. Secret is "whsec_<base64>"; the signed content
// is "<id>.<timestamp>.<rawBody>"; the header carries space-separated
// "v1,<base64sig>" entries — any match is valid.
function verifySignature(headers, rawBody) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "RESEND_WEBHOOK_SECRET not set" };
  const h = (name) => headers[name] || headers[name.toLowerCase()] || "";
  const id = h("svix-id");
  const ts = h("svix-timestamp");
  const sigHeader = h("svix-signature");
  if (!id || !ts || !sigHeader) return { ok: false, reason: "missing svix headers" };

  let key;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, "").trim(), "base64");
  } catch (e) {
    return { ok: false, reason: `bad secret encoding: ${e?.message || e}` };
  }
  const signedContent = `${id}.${ts}.${rawBody}`;
  const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
  const expBuf = Buffer.from(expected);

  const provided = sigHeader.split(" ").map((p) => p.split(",")[1]).filter(Boolean);
  for (const sig of provided) {
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}

// wo-<ticketId>@inbound...               → { ticketId, channel: "requester" }
// wo-<ticketId>--<channel>@inbound...    → { ticketId, channel }
function extractTicketRef(to) {
  const list = Array.isArray(to) ? to : [to];
  for (const entry of list) {
    const m = addrString(entry).match(/wo-([^@\s]+)@/i);
    if (m) {
      let token = m[1];
      let channel = "requester";
      const sep = token.indexOf("--");
      if (sep !== -1) {
        channel = token.slice(sep + 2).toLowerCase() || "requester";
        token = token.slice(0, sep);
      }
      return { ticketId: token, channel };
    }
  }
  return null;
}

async function fetchReceivedEmail(emailId) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !emailId) return null;
  try {
    const res = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) {
      console.warn("[resend-inbound] body fetch failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn("[resend-inbound] body fetch error", e?.message || e);
    return null;
  }
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>(?=)/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Drop quoted history below the usual delimiters so we post just the
// new reply, not the whole thread.
function topReply(text) {
  if (!text) return "";
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (/^On .*wrote:$/i.test(t)) break;
    if (/^-{2,}\s*Original Message/i.test(t)) break;
    if (/^From:\s/i.test(t)) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  const trimmed = out.join("\n").trim();
  return trimmed || String(text).trim();
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return resp(405, { ok: false });

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  // Signature first — anything that fails this is rejected hard so a
  // forged caller can't make us do work. Real Resend events past this
  // point always return 200 (with errors logged) so we don't end up in
  // a retry loop.
  const verified = verifySignature(event.headers || {}, rawBody);
  if (!verified.ok) {
    console.warn("[resend-inbound] rejected (401):", verified.reason);
    return resp(401, { ok: false, error: verified.reason });
  }

  try {
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.warn("[resend-inbound] bad json body");
      return resp(200, { ok: true, ignored: "bad json" });
    }

    if (payload?.type !== "email.received") {
      console.log("[resend-inbound] ignored type:", payload?.type || "unknown");
      return resp(200, { ok: true, ignored: payload?.type || "unknown" });
    }

    const data = payload.data || {};
    const ref = extractTicketRef(data.to);
    if (!ref) {
      console.log("[resend-inbound] ignored: no WO address in", JSON.stringify(data.to));
      return resp(200, { ok: true, ignored: "no WO address" });
    }
    const ticketId = ref.ticketId;
    const requestedChannel = ref.channel;
    const threadType = ALLOWED_THREAD_TYPES.has(requestedChannel)
      ? requestedChannel
      : "requester";

    const supabase = getSupabase();

    const { data: ticket, error: tErr } = await supabase
      .from("tickets").select("id").eq("id", ticketId).maybeSingle();
    if (tErr) {
      console.warn("[resend-inbound] ticket lookup error", tErr);
      return resp(200, { ok: true, error: "ticket lookup failed" });
    }
    if (!ticket) {
      console.log("[resend-inbound] ignored: unknown ticket", ticketId);
      return resp(200, { ok: true, ignored: "unknown ticket" });
    }

    const full = await fetchReceivedEmail(data.email_id || data.id);
    const from = addrString(data.from) || addrString(full?.from) || "Reply";
    const fromName = String(from).replace(/<[^>]*>/, "").trim() || from;
    const body = topReply(full?.text || htmlToText(full?.html) || "");
    const message =
      body || `(Reply received from ${fromName} — open it in Resend; body unavailable.)`;

    const { error: mErr } = await supabase.from("ticket_messages").insert({
      ticket_id: ticketId,
      user_id: null,
      user_name: fromName,
      user_role: requestedChannel === "store" ? "REPLY/store" : "REPLY",
      message,
      thread_type: threadType,
    });
    if (mErr) {
      console.error("[resend-inbound] message insert failed", mErr);
      // Still return 200 — Resend retrying won't fix a DB constraint error.
      return resp(200, { ok: true, error: "message insert failed", detail: mErr.message });
    }

    const { error: uErr } = await supabase
      .from("tickets")
      .update({
        awaiting_info: false,
        awaiting_info_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId);
    if (uErr) console.warn("[resend-inbound] ticket flag update failed", uErr);

    const { error: aErr } = await supabase.from("ticket_activities").insert({
      ticket_id: ticketId,
      user_id: null,
      user_name: fromName,
      user_role: "reply",
      update_type: "info_answer",
      event_type: "info_answered",
      notes: message.slice(0, 500),
      event_data: { channel: requestedChannel, thread_type: threadType, from },
      visibility: "all",
    });
    if (aErr) console.warn("[resend-inbound] activity insert failed", aErr);

    console.log(
      `[resend-inbound] ok ticket=${ticketId} channel=${requestedChannel} thread=${threadType}`,
    );
    return resp(200, { ok: true, ticketId, channel: requestedChannel });
  } catch (e) {
    console.error("[resend-inbound] unhandled error", e?.message || e, e?.stack);
    // Still 200 — the event itself was authentic, we don't want Resend
    // to retry-loop on our internal bug. Diagnose in Netlify logs.
    return resp(200, { ok: true, error: "internal" });
  }
};
