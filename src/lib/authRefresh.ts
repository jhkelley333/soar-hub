import { supabase } from "./supabase";

// Deduplicated access-token refresh.
//
// A page typically fires several API calls at once, all carrying the same
// access token. If that token just went stale they ALL come back 401 together —
// and if each handler independently calls supabase.auth.refreshSession(), they
// force several token rotations that race on the single rotating refresh token.
// The first rotation invalidates the token the others are using, and once past
// the server's short reuse-grace window that reads as reuse → a terminal
// SIGNED_OUT, i.e. a random logout minutes after signing in.
//
// This coalesces a burst into ONE refresh: the first caller starts it, everyone
// else awaits the same promise, and it clears when done so a later genuine
// refresh can run. Returns the fresh access token, or null if the refresh
// failed (dead refresh token, offline) — callers then surface the 401.
let inFlight: Promise<string | null> | null = null;

export function refreshAccessTokenOnce(): Promise<string | null> {
  if (!inFlight) {
    inFlight = supabase.auth
      .refreshSession()
      .then(({ data, error }) => {
        if (error) {
          console.warn("[auth] refreshSession failed", error.message);
          return null;
        }
        return data.session?.access_token ?? null;
      })
      .catch((e) => {
        console.warn("[auth] refreshSession threw", e);
        return null;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
