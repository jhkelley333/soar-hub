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

// Hard ceiling on initial auth resolution. If getSession() or loadProfile
// hasn't returned in this many ms we wipe persisted Supabase tokens and
// drop the user on the login screen rather than hanging on "Loading…".
// Tuned long enough to forgive bad LTE on cold loads, short enough that
// users don't sit staring at a spinner.
const AUTH_BOOT_TIMEOUT_MS = 8000;

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

  async function loadProfile(userId: string): Promise<{ hasProfile: boolean }> {
    const gen = ++generationRef.current;
    const [{ data: profileData }, { data: scopesData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_scopes").select("*").eq("user_id", userId),
    ]);
    if (gen !== generationRef.current) return { hasProfile: false }; // superseded — bail
    setProfile((profileData as Profile) ?? null);
    setScopes((scopesData as UserScope[]) ?? []);
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
    // Bump the generation so any in-flight loadProfile resolves to a
    // no-op rather than re-populating the cleared profile.
    generationRef.current++;
    setSession(null);
    setProfile(null);
    setScopes([]);
  }

  useEffect(() => {
    let cancelled = false;

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
          timeout<{ data: { session: Session | null } }>("getSession", AUTH_BOOT_TIMEOUT_MS),
        ]);
        initial = res.data.session;
      } catch (e) {
        if (cancelled) return;
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
        try {
          perfMark("auth: profile fetch start");
          await Promise.race([
            loadProfile(initial.user.id),
            timeout<{ hasProfile: boolean }>("loadProfile", AUTH_BOOT_TIMEOUT_MS),
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
        return;
      }
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
