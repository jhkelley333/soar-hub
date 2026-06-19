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
const CACHE_NAME = "soar-hub-v11";

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

// Last-resort navigation fallback: shown only when the network is down AND
// there's no cached shell to boot the SPA (e.g. a first load during a blip).
// Beats a hard browser "network error" page — it explains itself and quietly
// reloads, so the app recovers on its own the moment the connection returns.
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SOAR Hub</title>
<style>html,body{height:100%}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;background:#E8F1F8;color:#285780;display:grid;place-items:center;text-align:center;padding:24px}.t{font-weight:600;font-size:18px}.s{color:#52607a;font-size:14px;margin-top:8px;max-width:300px}</style>
</head><body><div><div class="t">Reconnecting…</div><div class="s">Your connection dropped for a moment. This page will retry automatically.</div></div>
<script>setTimeout(function(){location.reload()},4000)</script></body></html>`;

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

// ── App-icon badge (Badging API) ─────────────────────────────────────
// The numeric badge on the installed app icon. The count is persisted in
// IndexedDB so it survives SW restarts: the foreground app posts the exact
// unread total (message: "badge:set"), and while the app is closed each
// chat push increments that stored baseline. No-ops where the API or IDB
// isn't available (e.g. Android home screens).

const BADGE_DB = "soar-badge";
const BADGE_STORE = "kv";
const BADGE_KEY = "count";

function badgeDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BADGE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(BADGE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredBadge() {
  try {
    const db = await badgeDb();
    return await new Promise((resolve) => {
      const r = db.transaction(BADGE_STORE, "readonly").objectStore(BADGE_STORE).get(BADGE_KEY);
      r.onsuccess = () => resolve(typeof r.result === "number" ? r.result : 0);
      r.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

async function putStoredBadge(n) {
  try {
    const db = await badgeDb();
    await new Promise((resolve) => {
      const tx = db.transaction(BADGE_STORE, "readwrite");
      tx.objectStore(BADGE_STORE).put(n, BADGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

async function applyBadge(n) {
  const count = Math.max(0, n | 0);
  await putStoredBadge(count);
  try {
    if (count > 0) {
      if (self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
    } else if (self.navigator.clearAppBadge) {
      await self.navigator.clearAppBadge();
    }
  } catch {
    /* ignore — badge is best-effort */
  }
}

// Foreground app keeps the stored baseline exact.
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.type === "badge:set" && typeof msg.count === "number") {
    event.waitUntil(applyBadge(msg.count));
  }
});

// ── Web Push ─────────────────────────────────────────────────────────
// A push arrives as an encrypted JSON payload
//   { title, body, url?, tag?, badge?, badgeIncrement? }.
// Show it as a system notification; clicking it focuses an existing app
// window (or opens one) at the payload's url. If the payload carries a
// badge hint, update the app-icon count too.

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

  const tasks = [self.registration.showNotification(title, options)];
  if (typeof data.badge === "number") {
    tasks.push(applyBadge(data.badge));
  } else if (typeof data.badgeIncrement === "number") {
    tasks.push(getStoredBadge().then((c) => applyBadge(c + data.badgeIncrement)));
  }
  event.waitUntil(Promise.all(tasks));
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

  // Network-first for navigation / HTML document requests.
  //
  // The HTML entry-point references content-hashed bundles
  // (/assets/index-<hash>.js). Netlify does ATOMIC deploys: after a push,
  // only the new deploy's assets exist and the previous bundle 404s. So a
  // cached (stale) index.html can point at a bundle that no longer exists,
  // the entry script fails to load, and the app white/blue-screens. (A
  // prior stale-while-revalidate strategy traded this correctness for
  // faster cold start; the deploy breakage isn't worth it.)
  //
  // So: always fetch the freshest index.html when online — it's tiny and
  // served `no-cache`, so the conditional request settles as a cheap 304 —
  // guaranteeing the bundle reference matches what's actually deployed.
  // Fall back to the cached shell only when the network is unavailable
  // (offline), preserving the installed-app offline-shell goal. Every SPA
  // route resolves to the same index.html (Netlify SPA fallback), so we
  // key the cached shell on "/".
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch("/");
          if (fresh && fresh.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put("/", fresh.clone());
          }
          return fresh;
        } catch {
          // Offline / transient blip. Serve the cached shell so the SPA can
          // still boot and the client router takes over.
          const cache = await caches.open(CACHE_NAME);
          const cachedShell = (await cache.match("/")) || (await cache.match(request));
          if (cachedShell) return cachedShell;
          // No cached shell yet (e.g. first load during a blip). One more
          // network try on the real URL before giving up.
          try {
            const retry = await fetch(request);
            if (retry) return retry;
          } catch {
            /* still down */
          }
          // Last resort: a self-reloading "Reconnecting…" page instead of a
          // hard browser network-error screen.
          return new Response(OFFLINE_HTML, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      })(),
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
        // If the network fails and nothing is cached, `cached` is undefined —
        // returning that to respondWith throws "Failed to convert value to
        // 'Response'". Fall back to a real network-error Response instead.
        .catch(() => cached || Response.error());
      return cached || networkFetch;
    }),
  );
});
