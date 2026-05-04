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
// For this SPA we don't need cross-tab session locking (sessions are
// just rows in localStorage and are read fresh on each request), so we
// pass a no-op lock that always proceeds. Kills the orphaned-lock
// recovery message and the post-deploy hang.
const noopLock = <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn();

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: noopLock,
  },
});
