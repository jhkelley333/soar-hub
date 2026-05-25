import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "@/shared/ui/Toaster";
import { isStandalone } from "@/lib/push";
import { STAY_SIGNED_IN_KEY } from "./LoginPage";

// 2 hours of no activity = sign out. Activity = mouse, keyboard, touch,
// scroll. JWT itself has a 24h cap on the server side, so this layer
// only matters for "left their phone on the counter" cases.
//
// Skipped in the installed PWA: an app on someone's personal device is
// treated as trusted (like a native app) and stays signed in. The 2-hour
// rule still applies in browsers (incl. shared/desktop ones).
const IDLE_MS = 2 * 60 * 60 * 1000;
// How often to check the idle clock. 60s is plenty — fires within a
// minute of the threshold.
const CHECK_MS = 60 * 1000;

const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "click",
  "touchstart",
  "scroll",
] as const;

export function useIdleLogout() {
  const { session, signOut } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (!session) return;
    // Installed app = trusted personal device; no idle logout — UNLESS the
    // user unchecked "Stay signed in on this device" at login (e.g. a GM on
    // a shared store tablet), in which case the 2-hour rule still applies.
    const staySignedIn = localStorage.getItem(STAY_SIGNED_IN_KEY) !== "0";
    if (isStandalone() && staySignedIn) return;

    let lastActivity = Date.now();
    let signedOut = false;
    const update = () => {
      lastActivity = Date.now();
    };

    for (const e of ACTIVITY_EVENTS) {
      document.addEventListener(e, update, { passive: true });
    }

    const interval = window.setInterval(() => {
      if (signedOut) return;
      if (Date.now() - lastActivity >= IDLE_MS) {
        signedOut = true;
        toast.push("Signed out due to inactivity.", "info");
        signOut().catch(() => {
          /* signOut clears state synchronously; ignore network errors */
        });
      }
    }, CHECK_MS);

    return () => {
      for (const e of ACTIVITY_EVENTS) {
        document.removeEventListener(e, update);
      }
      window.clearInterval(interval);
    };
  }, [session, signOut, toast]);
}
