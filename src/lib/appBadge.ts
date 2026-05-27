// App-icon badge (Badging API) helpers for the installed PWA.
//
// Drives the numeric badge on the home-screen / dock icon from the unread
// chat count. No-ops gracefully where the API isn't available — Android
// home screens, browser tabs (non-installed), and older Safari — so callers
// don't need to feature-detect.
//
// Two surfaces stay in sync:
//   * Foreground (this file): the app sets the exact count whenever it
//     changes, and forwards it to the service worker so its stored baseline
//     matches reality.
//   * Background (sw.js): while the app is closed, the SW increments that
//     baseline as chat pushes arrive, so the icon ticks up like a native app.

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function appBadgeSupported(): boolean {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

// Set (or clear, when zero) the app-icon badge, and keep the service
// worker's stored baseline in step so background pushes count up from the
// right number.
export function applyAppBadge(count: number): void {
  const n = Math.max(0, Math.floor(count || 0));

  if (appBadgeSupported()) {
    const nav = navigator as BadgeNavigator;
    try {
      if (n > 0) void nav.setAppBadge?.(n);
      else void nav.clearAppBadge?.();
    } catch {
      /* ignore — badge is best-effort */
    }
  }

  // Forward to the SW (if it controls this page) so the closed-app increment
  // baseline tracks the live count. Harmless when unsupported.
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "badge:set", count: n });
  } catch {
    /* ignore */
  }
}
