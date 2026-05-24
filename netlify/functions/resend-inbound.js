// netlify/functions/resend-inbound.js
//
// Inbound webhook for Resend "email.received" events. A reply to a
// Request-More-Info email (sent with reply-to
// wo-<ticketId>@inbound.mysoarhub.com) lands here. We:
//   1. verify the Svix signature (Resend signs webhooks via Svix),
//   2. parse the ticket id out of the recipient address,
//   3. pull the reply body via the Resend received-emails API
//      (the webhook payload is metadata-only),
//   4. post the reply into the work order's chat thread, and
//   5. clear the Needs-info flag so the approval clock resumes.
//
// Signature verification is done manually with node:crypto so we don't
// add the svix dependency. Body fetch is best-effort: if it ever fails
// we still record that a reply arrived and clear Needs-info, so the loop
// degrades gracefully rather than breaking.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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
// ({ address, name }). Normalize to a plain string / address.
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

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
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

// wo-<ticketId>@inbound.mysoarhub.com → ticketId
function extractTicketId(to) {
  const list = Array.isArray(to) ? to : [to];
  for (const entry of list) {
    const m = addrString(entry).match(/wo-([^@\s]+)@/i);
    if (m) return m[1];
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
      console.warn("[resend-inbound] body fetch failed", res.status);
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

// Keep just the new reply, dropping quoted history below the usual
// delimiters ("On … wrote:", "From:", leading ">").
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

  const verified = verifySignature(event.headers || {}, rawBody);
  if (!verified.ok) {
    console.warn("[resend-inbound] rejected:", verified.reason);
    return resp(401, { ok: false, error: verified.reason });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return resp(400, { ok: false, error: "bad json" });
  }

  // Acknowledge anything that isn't an inbound email so Resend stops.
  if (payload?.type !== "email.received") {
    return resp(200, { ok: true, ignored: payload?.type || "unknown" });
  }

  const data = payload.data || {};
  const ticketId = extractTicketId(data.to);
  if (!ticketId) return resp(200, { ok: true, ignored: "no WO address" });

  const supabase = getSupabase();
  const { data: ticket } = await supabase
    .from("tickets").select("id").eq("id", ticketId).maybeSingle();
  if (!ticket) return resp(200, { ok: true, ignored: "unknown ticket" });

  const full = await fetchReceivedEmail(data.email_id || data.id);
  const from = addrString(data.from) || addrString(full?.from) || "Reply";
  const fromName = String(from).replace(/<[^>]*>/, "").trim() || from;
  const body = topReply(full?.text || htmlToText(full?.html) || "");
  const message = body || `(Reply received from ${fromName} — open it in Resend; body unavailable.)`;

  await supabase.from("ticket_messages").insert({
    ticket_id: ticketId,
    user_id: null,
    user_name: fromName,
    user_role: "REPLY",
    message,
    thread_type: "requester",
  });

  await supabase
    .from("tickets")
    .update({ awaiting_info: false, awaiting_info_at: null, updated_at: new Date().toISOString() })
    .eq("id", ticketId);

  await supabase.from("ticket_activities").insert({
    ticket_id: ticketId,
    user_id: null,
    user_name: fromName,
    user_role: "reply",
    update_type: "info_answer",
    event_type: "info_answered",
    notes: message.slice(0, 500),
    visibility: "all",
  });

  return resp(200, { ok: true, ticketId });
};
