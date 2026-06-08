import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly at module load. A misconfigured env should never produce
  // a confusing runtime error half a screen later.
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in values from your Supabase project settings."
  );
}

// supabase-js defaults to navigator.locks for cross-tab session
// synchronization. The lock is stored under
// "lock:sb-<project>-auth-token" and survives a hard page unload / tab
// crash / deploy. On the next page load the new client waits 5s for the
// orphaned lock, logs a warning, and force-acquires — but during that
// window getSession() hangs and AuthProvider gets stuck on "Loading…".
//
// We don't want that cross-tab lock (it caused the post-deploy boot
// hang), but we DO need to serialize auth operations *within this page*.
// supabase-js routes getSession() and every token refresh through this
// lock; on iOS the installed PWA wakes from suspension and fires several
// refresh triggers at once (visibilitychange + online + the auto-refresh
// tick + boot getSession). With no serialization those refreshes race on
// the single rotating refresh token — the first rotates it, the rest are
// rejected as "already used", and supabase-js emits SIGNED_OUT, logging
// the user out on reopen.
//
// So instead of a no-op, use an in-page promise queue. It serializes
// every lock-protected call on one chain (killing the refresh race) but
// holds no persistent / cross-tab state, so there's nothing to orphan and
// the boot hang never returns. A fresh page load starts with a resolved
// chain, so the first acquire runs immediately.
let authLockChain: Promise<unknown> = Promise.resolve();
function inPageLock<R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const run = authLockChain.then(fn, fn);
  // Keep the chain alive regardless of outcome so one rejected operation
  // doesn't wedge every subsequent acquire.
  authLockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: inPageLock,
    // Pin the session storage key to the project ref. supabase-js otherwise
    // derives it from the URL hostname's first label, so moving the client off
    // the raw `<ref>.supabase.co` URL onto the `api.mysoarhub.com` custom
    // domain (done to dodge ISP-level *.supabase.co DNS blocklisting) would
    // change the key from `sb-mebzvovvdugkwjypwepg-auth-token` to
    // `sb-api-auth-token` and silently log everyone out on cutover. Pinning it
    // keeps existing sessions valid across the domain swap. The AuthProvider
    // purge matches `sb-*-auth-token` by pattern, so it still clears this key.
    storageKey: "sb-mebzvovvdugkwjypwepg-auth-token",
  },
});
