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

  async function loadProfile(userId: string) {
    const gen = ++generationRef.current;
    const [{ data: profileData }, { data: scopesData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_scopes").select("*").eq("user_id", userId),
    ]);
    if (gen !== generationRef.current) return; // superseded — bail
    setProfile((profileData as Profile) ?? null);
    setScopes((scopesData as UserScope[]) ?? []);
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
      try {
        const { data: { session: initial } } = await Promise.race([
          supabase.auth.getSession(),
          timeout<{ data: { session: Session | null } }>("getSession", AUTH_BOOT_TIMEOUT_MS),
        ]);
        if (cancelled) return;
        setSession(initial);
        if (initial?.user) {
          await Promise.race([
            loadProfile(initial.user.id),
            timeout<void>("loadProfile", AUTH_BOOT_TIMEOUT_MS),
          ]);
        }
      } catch (e) {
        if (cancelled) return;
        console.warn("[auth] boot failed; purging persisted session and falling through to login", e);
        await clearStaleSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      if (next?.user) {
        try {
          // Bound the post-auth profile load — a hung Supabase query
          // here used to leave LoginPage stuck on "Working…" forever
          // because the session was set but profile never arrived.
          await Promise.race([
            loadProfile(next.user.id),
            timeout<void>("loadProfile (auth change)", AUTH_BOOT_TIMEOUT_MS),
          ]);
        } catch (e) {
          // The session itself is valid (we just got it from supabase-
          // js); only the profile fetch failed. Wiping the session
          // would silently bounce the user back to the login screen
          // with no explanation. Surface the error and leave the
          // session intact so they can retry / refresh / contact
          // support.
          console.warn("[auth] post-auth-change loadProfile failed; keeping session, clearing profile", e);
          setProfile(null);
          setScopes([]);
        }
      } else {
        // Sign-out (or session expired). Bump the generation so any
        // in-flight loadProfile bails before re-populating profile.
        generationRef.current++;
        setProfile(null);
        setScopes([]);
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
