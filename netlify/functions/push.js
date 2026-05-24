// netlify/functions/push.js
//
// Web Push subscription management for the installed PWA.
//   GET  ?action=key          → { publicKey }  (VAPID public key, not secret)
//   POST subscribe  { subscription, userAgent? }  → store this device
//   POST unsubscribe { endpoint }                 → forget this device
//   POST test                                     → send a ping to this user
//
// Sending of real alerts (new message / announcement) lives in chat.js
// via _lib/push.js. This function only manages the subscription rows.

import { createClient } from "@supabase/supabase-js";
import { sendPushToUsers, pushConfigured } from "./_lib/push.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function getCaller(event, supa) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes } = await supa.auth.getUser(token);
  if (!userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, is_active")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;
  return profile;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  const action = (event.queryStringParameters || {}).action || "";

  // Public, non-secret VAPID key the client needs to subscribe. No auth
  // required — it's the same key embedded in any push-enabled site.
  if (action === "key") {
    return respond(200, {
      ok: true,
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      configured: pushConfigured(),
    });
  }

  const supa = getSupabase();
  const caller = await getCaller(event, supa);
  if (!caller) return respond(401, { ok: false, message: "Not authenticated." });
  const uid = caller.id;

  try {
    if (action === "subscribe" && event.httpMethod === "POST") {
      const { subscription, userAgent } = JSON.parse(event.body || "{}");
      const endpoint = subscription?.endpoint;
      const p256dh = subscription?.keys?.p256dh;
      const auth = subscription?.keys?.auth;
      if (!endpoint || !p256dh || !auth) {
        return respond(400, { ok: false, message: "Invalid subscription." });
      }
      // Upsert on endpoint — a device may re-subscribe (e.g. after the
      // browser rotates its endpoint), and the endpoint may move users
      // if someone signs in on a shared device.
      const { error } = await supa
        .from("push_subscriptions")
        .upsert(
          {
            user_id: uid,
            endpoint,
            p256dh,
            auth,
            user_agent: (userAgent || "").slice(0, 400) || null,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        );
      if (error) throw error;
      return respond(200, { ok: true });
    }

    if (action === "unsubscribe" && event.httpMethod === "POST") {
      const { endpoint } = JSON.parse(event.body || "{}");
      if (!endpoint) return respond(400, { ok: false, message: "endpoint required." });
      await supa
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", endpoint)
        .eq("user_id", uid);
      return respond(200, { ok: true });
    }

    if (action === "test" && event.httpMethod === "POST") {
      await sendPushToUsers(supa, [uid], {
        title: "SOAR Hub",
        body: "Notifications are on — you'll get alerts here.",
        url: "/chat",
        tag: "soar-test",
      });
      return respond(200, { ok: true });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (e) {
    console.error("[push]", action, e?.message || e);
    return respond(500, { ok: false, message: e?.message || "Server error" });
  }
};
