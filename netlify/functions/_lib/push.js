// Shared Web Push sender. Used by push.js (test pings) and chat.js
// (new-message / announcement alerts). Signs payloads with the VAPID
// keypair from env and prunes dead subscriptions (410/404) as it goes.
//
// Env required (set in Netlify):
//   VAPID_PUBLIC_KEY   — also served to the client via push?action=key
//   VAPID_PRIVATE_KEY  — secret
//   VAPID_SUBJECT      — "mailto:you@domain" or an https URL

import webpush from "web-push";

let configured = false;

export function pushConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

function ensureConfigured() {
  if (configured) return true;
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

// Send a notification to every device of the given users. Best-effort:
// failures are swallowed (logged) so a dead endpoint never breaks the
// originating request. Dead endpoints (404/410) are deleted.
//
//   payload: { title, body, url?, tag? }
export async function sendPushToUsers(supa, userIds, payload, opts = {}) {
  if (!ensureConfigured()) return;
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  const excluded = opts.excludeUserId;
  const targets = excluded ? ids.filter((u) => u !== excluded) : ids;
  if (targets.length === 0) return;

  const { data: subs } = await supa
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", targets);
  if (!subs || subs.length === 0) return;

  const body = JSON.stringify(payload);
  const dead = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
      } catch (err) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        else console.warn("[push] send failed", code || err?.message || err);
      }
    }),
  );

  if (dead.length) {
    await supa.from("push_subscriptions").delete().in("id", dead);
  }
}
