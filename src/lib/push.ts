// Web Push client helpers. Subscribes the current device to push via the
// service worker's PushManager and registers the subscription with the
// push function. iOS only permits any of this once the PWA is installed
// to the Home Screen — see isStandalone()/isIOS() for the gating UI.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/push";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; disambiguate by touch support.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// True when launched from an installed PWA (Home Screen) rather than a
// browser tab. iOS requires this for push to work at all.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

async function getVapidKey(): Promise<string> {
  const res = await fetch(`${FN}?action=key`);
  const body = await res.json().catch(() => ({}));
  if (!body?.publicKey) {
    throw new Error("Push isn't configured on the server yet (missing VAPID key).");
  }
  return body.publicKey as string;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return Boolean(sub);
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("This browser doesn't support notifications.");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    throw new Error("Notifications are blocked. Turn them on in your device settings, then try again.");
  }

  const reg = await navigator.serviceWorker.ready;
  const key = await getVapidKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
    });
  }

  const res = await fetch(`${FN}?action=subscribe`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(body.message || "Couldn't save your subscription.");
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe().catch(() => {});
  await fetch(`${FN}?action=unsubscribe`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

export async function sendTestPush(): Promise<void> {
  const res = await fetch(`${FN}?action=test`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.message || "Test failed.");
}
