import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { AuthProvider } from "@/auth/AuthProvider";
import { router } from "@/app/router";
import { queryClient } from "@/lib/queryClient";
import { persistOptions } from "@/lib/queryPersister";
import { ToastProvider } from "@/shared/ui/Toaster";
import { registerServiceWorker } from "@/lib/registerSW";
import { requestPersistentStorage } from "@/lib/persistStorage";
import { perfMark } from "@/lib/perf";
import "@/styles/globals.css";

perfMark("bundle eval");

// Defensive: Supabase auth emails (recovery + invite) should redirect to
// purpose-built pages. If URL Configuration is misconfigured Supabase
// falls back to the Site URL root and strands the user on the dashboard
// with a temporary session and no setup UI. Detect the auth type in the
// hash and bounce before React mounts so the supabase-js
// detectSessionInUrl handler runs on the right page. We preserve the
// hash exactly so tokens survive the bounce.
const _hash = window.location.hash;
const _path = window.location.pathname;
if (_hash.includes("type=recovery") && _path !== "/reset-password") {
  window.location.replace("/reset-password" + _hash);
} else if (_hash.includes("type=invite") && _path !== "/accept-invite") {
  window.location.replace("/accept-invite" + _hash);
}

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

perfMark("react mount");
createRoot(root).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
    >
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </PersistQueryClientProvider>
  </StrictMode>
);

// Tell the boot watchdog (inline in index.html) the bundle loaded and
// rendered, so it doesn't trigger a recovery reload.
(window as unknown as { __SOAR_BOOTED__?: boolean }).__SOAR_BOOTED__ = true;

// Register the service worker after the initial render kicks off so
// the SW install never competes with first paint. Dev / unsupported
// browsers no-op.
registerServiceWorker();

// Ask the OS to keep our storage durable so the saved login (and offline
// cache) survives storage eviction — the main reason the PWA "forgets" people.
void requestPersistentStorage();
