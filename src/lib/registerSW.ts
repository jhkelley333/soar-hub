// Service worker registration. Idempotent — bails on unsupported
// browsers (no `serviceWorker` API) and on DEV (Vite HMR conflicts
// with a controlling SW). Silent-fails on register errors so a
// broken SW deploy never takes down the page.
//
// Bumping CACHE_NAME in /public/sw.js triggers a fresh install on
// the next visit; the SW's skipWaiting + clients.claim ensures the
// new shell activates without a manual reload.

export function registerServiceWorker(): void {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Vite's dev server breaks under a controlling SW (HMR fetches get
  // intercepted). Production-only registration keeps dev fast.
  if (import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // Log so we notice on deploys, but don't surface to users.
      console.warn("[sw] registration failed:", err);
    });
  });
}
