// SOAR Hub service worker — PWA Tier A.
//
// Goals:
//   1. App shell loads offline once installed (open icon → app appears
//      even without a connection).
//   2. Static assets (JS, CSS, fonts, icons) load fast on repeat visits
//      via stale-while-revalidate.
//   3. Network calls to Netlify functions, Supabase, and any cross-
//      origin request are NEVER touched — those need fresh auth +
//      data and have their own caching at the React Query layer.
//
// Cache versioning: bump CACHE_NAME's suffix to invalidate all caches
// on the next install. The activate handler purges every cache whose
// name doesn't match.

const CACHE_NAME = "soar-hub-v1";

// Precache the bare minimum the app needs to render an offline shell.
// Vite hashes JS/CSS bundle filenames, so we let runtime caching pick
// those up the first time they load — listing them here would tie us
// to specific hashes that change every deploy.
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
];

self.addEventListener("install", (event) => {
  // Take over from any previous SW immediately so users don't wait
  // through a stale-tab handoff after a deploy.
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        /* offline at install — fine, runtime cache fills it */
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only. Cross-origin requests (Supabase, fonts.googleapis,
  // etc.) bypass the SW entirely — those have their own CORS + auth
  // semantics and we don't want to risk caching them stale.
  if (url.origin !== self.location.origin) return;

  // Skip Netlify functions and auth callbacks — these need to hit the
  // network every time and any cached response could leak across users.
  if (url.pathname.startsWith("/.netlify/")) return;

  // Network-first for navigation / HTML document requests. The shell
  // gets refreshed on every visit so a new deploy propagates fast;
  // offline / network-fail falls back to the cached shell.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/")),
        ),
    );
    return;
  }

  // Stale-while-revalidate for static assets — JS / CSS / fonts /
  // images / SVG. The cached version serves immediately (fast), and a
  // background fetch updates the cache for next time.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});
