import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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

  async function loadProfile(userId: string) {
    const [{ data: profileData }, { data: scopesData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_scopes").select("*").eq("user_id", userId),
    ]);
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
          await loadProfile(next.user.id);
        } catch (e) {
          console.warn("[auth] loadProfile after auth change failed; clearing stale session", e);
          await clearStaleSession();
        }
      } else {
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
        setSession(null);
        setProfile(null);
        setScopes([]);
        try {
          await supabase.auth.signOut();
        } catch (e) {
          console.warn("[auth] signOut threw; local state already cleared", e);
        }
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
