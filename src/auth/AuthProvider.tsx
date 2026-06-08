import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isStandalone } from "@/lib/push";
import { queryClient } from "@/lib/queryClient";
import { clearPersistedQueryCache } from "@/lib/queryPersister";
import { perfMark, perfReport } from "@/lib/perf";
import type { Profile, UserScope } from "@/types/database";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  scopes: UserScope[];
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// One-shot flag set when the user is logged out *involuntarily* (a token
// refresh hit a terminal auth error and supabase-js cleared the session),
// read + cleared by LoginPage to show a "session expired" notice instead
// of a silent bounce. Kept in sessionStorage rather than a context field
// so it crosses the AuthProvider→Router boundary trivially and clears
// itself when the tab closes.
export const SESSION_EXPIRED_KEY = "soar_session_expired";

// Hard ceiling on initial auth resolution. If getSession() or loadProfile
// hasn't returned in this many ms we wipe persisted Supabase tokens and
// drop the user on the login screen rather than hanging on "Loading…".
// Tuned long enough to forgive bad LTE on cold loads, short enough that
// users don't sit staring at a spinner.
const AUTH_BOOT_TIMEOUT_MS = 8000;

// Profile-fetch retry. A transient network/DNS/PostgREST blip makes the
// profiles query return { data: null, error } — which must never be read as
// "no profile" (that wipes a loaded profile and bounces the user to the
// "Couldn't load your profile" screen). Retry a couple times; if it still
// errors, the caller keeps the existing profile. Backoffs sum well under the
// 8s boot ceiling above.
const PROFILE_MAX_ATTEMPTS = 3;
const PROFILE_BACKOFF_MS = [600, 1500];

function timeout<T>(label: string, ms: number): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`[auth] ${label} timed out after ${ms}ms`)), ms);
  });
}

// Best-effort wipe of any persisted Supabase auth state (`sb-*-auth-token`
// keys in localStorage + sessionStorage). After a backend change or token
// rotation the persisted refresh token can be permanently rejected — and
// the supabase-js client will silently retry forever. Wiping forces a
// clean login on the next render.
function purgeSupabaseStorage() {
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
          doomed.push(key);
        }
      }
      for (const key of doomed) store.removeItem(key);
    } catch {
      // storage may be disabled (private mode, quota); nothing to do.
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [scopes, setScopes] = useState<UserScope[]>([]);
  const [loading, setLoading] = useState(true);

  // Monotonically increasing token tracking the "current" auth context.
  // Every time we kick off a loadProfile we capture the current value;
  // if anything that invalidates the in-flight load happens before it
  // resolves (a sign-out, a different user signing in, an explicit
  // refresh, a stale-session purge), we bump the counter and the
  // resolving call sees its captured generation no longer matches and
  // bails before clobbering state with stale data.
  //
  // Without this, signing out → signing in as user B can briefly
  // render user A's profile because the boot path's loadProfile(A)
  // resolves AFTER onAuthStateChange has fired for user B.
  const generationRef = useRef(0);

  // Mirror of profile.id without dep-array invalidation. The
  // onAuthStateChange listener captures profile from initial closure,
  // so reading `profile` directly inside it would always see null.
  // We need the live current value to decide whether to skip a
  // redundant reload and whether to preserve the existing profile on
  // a background timeout.
  const profileIdRef = useRef<string | null>(null);
  useEffect(() => { profileIdRef.current = profile?.id ?? null; }, [profile]);

  // True while an app-initiated sign-out is in flight (explicit signOut,
  // or the OAuth no-profile bounce). Lets the auth listener tell a
  // deliberate sign-out apart from an involuntary one so only the latter
  // surfaces the "session expired" prompt.
  const appSignOutRef = useRef(false);
  // Whether we've held a real authenticated session this load. Guards the
  // involuntary-logout signal so it never fires at boot for a user who
  // simply isn't logged in yet.
  const wasAuthedRef = useRef(false);

  async function loadProfile(userId: string): Promise<{ hasProfile: boolean }> {
    const gen = ++generationRef.current;

    // The profiles + scopes queries resolve to { data, error }; supabase-js
    // does NOT throw on a network failure — it returns error with data:null.
    // Reading that as "no profile" is the bug behind the "logged in, then
    // minutes later kicked to Couldn't load your profile" reports: a transient
    // re-fetch wiped a perfectly good profile. So: retry transient errors, and
    // if they persist, THROW — the caller keeps the existing profile (same
    // user) rather than nulling it.
    let profileData: Profile | null = null;
    let scopesData: UserScope[] = [];
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= PROFILE_MAX_ATTEMPTS; attempt++) {
      const [profileRes, scopesRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("user_scopes").select("*").eq("user_id", userId),
      ]);
      if (gen !== generationRef.current) return { hasProfile: false }; // superseded — bail
      if (!profileRes.error && !scopesRes.error) {
        profileData = (profileRes.data as Profile) ?? null;
        scopesData = (scopesRes.data as UserScope[]) ?? [];
        lastErr = null;
        break;
      }
      lastErr = profileRes.error ?? scopesRes.error;
      if (attempt < PROFILE_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, PROFILE_BACKOFF_MS[attempt - 1] ?? 1500));
      }
    }
    if (lastErr) throw lastErr; // exhausted retries — let the caller keep the existing profile

    setProfile(profileData);
    setScopes(scopesData);
    return { hasProfile: !!profileData };
  }

  // Clear local auth state and any stale session in storage. Called when we
  // detect the persisted session is no longer valid (e.g. JWT expired and
  // refresh failed) — without this the app would hang in "Loading…" forever
  // because getSession() returns the stale session but every subsequent API
  // call 401s.
  async function clearStaleSession() {
    try {
      await Promise.race([supabase.auth.signOut(), timeout("signOut", 2000)]);
    } catch {
      // ignore — we just want the local state cleared
    }
    purgeSupabaseStorage();
    queryClient.clear();
    void clearPersistedQueryCache();
    // Bump the generation so any in-flight loadProfile resolves to a
    // no-op rather than re-populating the cleared profile.
    generationRef.current++;
    setSession(null);
    setProfile(null);
    setScopes([]);
  }

  useEffect(() => {
    let cancelled = false;

    // The installed PWA is a trusted personal device that gets cold-launched
    // after long suspensions, so its boot getSession() often has to refresh
    // the token over a slow mobile radio. Give it far more patience than a
    // browser tab, and (below) never purge the stored token on a boot
    // timeout — a slow refresh must not log the app out.
    const standalone = isStandalone();
    const bootMs = standalone ? 25_000 : AUTH_BOOT_TIMEOUT_MS;

    (async () => {
      const finish = () => {
        if (cancelled) return;
        setLoading(false);
        perfMark("auth: interactive");
        perfReport();
      };

      // Step 1 — read the persisted session. With the no-op lock this is
      // a local read and should be near-instant; a timeout/throw here
      // means the client is wedged or the stored token is unreadable, so
      // clear it for a clean login. This is genuinely abnormal and is the
      // ONLY boot path that purges — distinct from a slow profile fetch
      // below, which must never clear anything.
      let initial: Session | null = null;
      try {
        perfMark("auth: getSession start");
        const res = await Promise.race([
          supabase.auth.getSession(),
          timeout<{ data: { session: Session | null } }>("getSession", bootMs),
        ]);
        initial = res.data.session;
      } catch (e) {
        if (cancelled) return;
        if (standalone) {
          // PWA: a slow/hung cold-launch refresh must NOT wipe the saved
          // login. Keep the stored token so this launch's autoRefresh — or
          // the next launch — can recover, and just fall through to the
          // login screen for now instead of purging. (A genuinely dead
          // token resolves fast as a null session, not a timeout, so this
          // only ever catches network hangs.)
          console.warn("[auth] getSession slow/hung in PWA; preserving token for retry", e);
          finish();
          return;
        }
        console.warn("[auth] getSession failed during boot; clearing stale session", e);
        await clearStaleSession();
        finish();
        return;
      }
      if (cancelled) return;
      perfMark("auth: session ready");
      setSession(initial);

      // Step 2 — load the profile. CRITICAL: a slow or failed profile
      // fetch must NEVER destroy a valid session. On a cold mobile radio
      // the profiles + user_scopes queries can blow past the timeout even
      // though the session is perfectly good — purging here logged users
      // out on bad networks. Keep the session and let onAuthStateChange's
      // INITIAL_SESSION retry the profile; ProtectedRoute surfaces a
      // recoverable "couldn't load profile" state until it lands. This
      // mirrors the running token-refresh path, which already preserves
      // the session on a profile-load failure.
      if (initial?.user) {
        wasAuthedRef.current = true;
        try {
          perfMark("auth: profile fetch start");
          await Promise.race([
            loadProfile(initial.user.id),
            timeout<{ hasProfile: boolean }>("loadProfile", bootMs),
          ]);
          perfMark("auth: profile ready");
        } catch (e) {
          if (cancelled) return;
          console.warn("[auth] boot profile load failed; keeping session, INITIAL_SESSION will retry", e);
        }
      }

      finish();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, next) => {
      setSession(next);
      if (!next?.user) {
        // Sign-out (or session expired). Bump the generation so any
        // in-flight loadProfile bails before re-populating profile.
        generationRef.current++;
        setProfile(null);
        setScopes([]);
        // Involuntary logout = a SIGNED_OUT we didn't initiate, after we
        // were actually signed in. supabase-js only emits this on a
        // terminal refresh failure (a transient network error keeps the
        // session); the refresh token is genuinely dead, so there's no
        // recovery — we just leave a one-shot flag so LoginPage can
        // explain why. ProtectedRoute handles the redirect + return-to.
        if (event === "SIGNED_OUT" && !appSignOutRef.current && wasAuthedRef.current) {
          try { sessionStorage.setItem(SESSION_EXPIRED_KEY, "1"); } catch {}
        }
        appSignOutRef.current = false;
        wasAuthedRef.current = false;
        return;
      }
      wasAuthedRef.current = true;
      // Skip the reload on routine token refreshes for the same user.
      // Supabase fires onAuthStateChange every ~50 minutes with event
      // TOKEN_REFRESHED — the profile row hasn't changed, so the
      // re-query is wasted work that also gives a transient PostgREST
      // hiccup a chance to nuke the in-memory profile via timeout. We
      // only need to (re)fetch when the user actually signed in,
      // their metadata changed, or we don't yet have a profile loaded.
      const currentProfileId = profileIdRef.current;
      const sameUser = currentProfileId === next.user.id;
      const needReload =
        event === "SIGNED_IN" ||
        event === "USER_UPDATED" ||
        event === "INITIAL_SESSION" ||
        !sameUser;
      if (!needReload) return;
      try {
        // Bound the post-auth profile load — a hung Supabase query
        // here used to leave LoginPage stuck on "Working…" forever
        // because the session was set but profile never arrived.
        const result = await Promise.race([
          loadProfile(next.user.id),
          timeout<{ hasProfile: boolean }>(
            "loadProfile (auth change)", AUTH_BOOT_TIMEOUT_MS,
          ),
        ]);
        // SIGNED_IN but no matching profile row = OAuth login from
        // a Google account that wasn't pre-invited. Sign them out
        // and route to /login with an error flag so they're not
        // stranded in a broken state. Only enforce on SIGNED_IN —
        // background events keep their existing state per the
        // earlier hardening.
        if (event === "SIGNED_IN" && !result.hasProfile) {
          console.warn("[auth] SIGNED_IN with no matching profile; signing out");
          appSignOutRef.current = true; // app-initiated; not a session expiry
          try { await supabase.auth.signOut(); } catch {}
          purgeSupabaseStorage();
          generationRef.current++;
          setSession(null);
          setProfile(null);
          setScopes([]);
          try {
            const url = new URL(window.location.href);
            url.pathname = "/login";
            url.searchParams.set("error", "no_profile");
            window.location.replace(url.toString());
          } catch {}
        }
      } catch (e) {
        // Failure path. If we already have a profile loaded for this
        // user, KEEP it — the timeout was almost certainly a transient
        // PostgREST blip and clearing it would log the user out of
        // every guarded route until they navigate. If we don't yet
        // have a profile, clear scopes so role checks fail closed.
        if (sameUser) {
          console.warn("[auth] background loadProfile failed; keeping existing profile", e);
        } else {
          console.warn("[auth] post-auth-change loadProfile failed; keeping session, clearing profile", e);
          setProfile(null);
          setScopes([]);
        }
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      scopes,
      loading,
      signOut: async () => {
        // Clear React state immediately so ProtectedRoute redirects on the
        // next render — don't wait for onAuthStateChange to bounce back.
        // Bump the generation so any in-flight loadProfile bails out
        // instead of re-populating after we just cleared.
        appSignOutRef.current = true; // deliberate; suppress the expiry prompt
        generationRef.current++;
        setSession(null);
        setProfile(null);
        setScopes([]);
        try {
          await Promise.race([supabase.auth.signOut(), timeout("signOut", 2000)]);
        } catch (e) {
          console.warn("[auth] signOut threw; local state already cleared", e);
        }
        // supabase-js can leave the persisted token behind when its
        // internal flow times out or the network call fails — and on
        // the next pageload getSession() rehydrates it, so the user
        // appears "still signed in" after explicitly signing out. Wipe
        // the keys directly so coming back to the URL lands on login.
        purgeSupabaseStorage();
        // Drop the persisted (IndexedDB) query cache so a shared device
        // never hydrates this user's chat / data for whoever logs in next.
        queryClient.clear();
        void clearPersistedQueryCache();
      },
      refresh: async () => {
        if (session?.user) await loadProfile(session.user.id);
      },
    }),
    [session, profile, scopes, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
