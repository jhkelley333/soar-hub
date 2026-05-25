// First-run "soft ask" for push notifications. Shows once, as a bottom
// card, when the app is running where push can actually work (installed
// PWA, or any non-iOS browser) and the user hasn't decided yet. Tapping
// Enable triggers the real OS permission prompt — we never fire that
// cold, because iOS only lets you ask once and a reflexive "Don't Allow"
// is permanent. "Not now" / dismiss is remembered so we don't nag.

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import {
  pushSupported,
  isIOS,
  isStandalone,
  notificationPermission,
  isPushEnabled,
  enablePush,
} from "@/lib/push";

const DISMISS_KEY = "soar-push-primer-dismissed";

export function PushPrimer() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    if (isIOS() && !isStandalone()) return; // futile in an iOS Safari tab
    if (notificationPermission() !== "default") return; // already decided
    if (localStorage.getItem(DISMISS_KEY)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    isPushEnabled().then((on) => {
      if (cancelled || on) return;
      // Brief delay so it doesn't collide with the launch splash.
      timer = setTimeout(() => setShow(true), 1200);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      await enablePush();
      localStorage.setItem(DISMISS_KEY, "1");
      setShow(false);
      toast.push("Notifications are on.", "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't enable notifications.", "error");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-24 lg:pb-4">
      <div className="mx-auto max-w-md rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-midnight-100">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Bell className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-midnight-900">Turn on notifications</p>
            <p className="mt-0.5 text-[13px] text-midnight-600">
              Get alerts for new messages and announcements, even when the app is closed.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 rounded-full p-1 text-midnight-400 hover:bg-surface-muted"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="h-10 flex-1 rounded-lg text-[14px] font-medium text-midnight-600 hover:bg-surface-muted"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="h-10 flex-1 rounded-lg bg-accent text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Enabling…" : "Enable"}
          </button>
        </div>
      </div>
    </div>
  );
}
