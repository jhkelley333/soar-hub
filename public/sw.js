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

// Bump the version suffix any time we ship a change users need to
// pick up immediately (e.g. a stuck-cache fix). The activate handler
// below purges every cache whose name doesn't match this one.
const CACHE_NAME = "soar-hub-v7";

// Precache the bare minimum the app needs to render an offline shell.
// Vite hashes JS/CSS bundle filenames, so we let runtime caching pick
// those up the first time they load — listing them here would tie us
// to specific hashes that change every deploy.
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/app-icon.png",
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

// ── Web Push ─────────────────────────────────────────────────────────
// A push arrives as an encrypted JSON payload { title, body, url?, tag? }.
// Show it as a system notification; clicking it focuses an existing app
// window (or opens one) at the payload's url.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "SOAR Hub", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SOAR Hub";
  const options = {
    body: data.body || "",
    icon: "/app-icon.png",
    badge: "/app-icon.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
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

  // Stale-while-revalidate for navigation / HTML document requests.
  //
  // The previous strategy was network-first: every load blocked on a
  // full fetch of index.html before the app could boot. Because the
  // Netlify header pins index.html to `no-store`, that fetch is a
  // guaranteed network round-trip on the critical path — measured at
  // 80ms on a warm connection but ~1000ms on a cold mobile radio,
  // entirely gating time-to-interactive.
  //
  // Now we serve the cached shell immediately (single-digit ms, no
  // network) and revalidate in the background, so the app starts
  // booting at once and the worst-case cold-radio penalty no longer
  // sits in front of first paint. The tradeoff: a user lands on the
  // PREVIOUS entry-point HTML for one load after a deploy, then the
  // background refresh updates the cache for the next load. That's safe
  // because /assets/* are content-hashed + immutable (the old shell's
  // bundle refs still resolve), and the SW's skipWaiting + clients.claim
  // mean a genuinely breaking shell change still propagates within a
  // load. Every SPA route is served the same index.html (Netlify SPA
  // fallback), so we always key the shell on "/".
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedShell = await cache.match("/");
        const refresh = fetch("/")
          .then((response) => {
            if (response.ok) cache.put("/", response.clone());
            return response;
          })
          .catch(() => undefined);
        if (cachedShell) {
          // Don't block the response on the refresh, but keep the SW
          // alive until it finishes so the cache actually updates.
          event.waitUntil(refresh);
          return cachedShell;
        }
        // First visit (or shell evicted): nothing cached yet, so wait on
        // the network and fall back to whatever we can serve.
        return (await refresh) || (await cache.match(request)) || fetch(request);
      }),
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
