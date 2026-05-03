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
      await supabase.auth.signOut();
    } catch {
      // ignore — we just want the local state cleared
    }
    setSession(null);
    setProfile(null);
    setScopes([]);
  }

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        if (cancelled) return;
        setSession(session);
        if (session?.user) {
          try {
            await loadProfile(session.user.id);
          } catch (e) {
            console.warn("[auth] initial loadProfile failed; clearing stale session", e);
            if (!cancelled) await clearStaleSession();
          }
        }
      })
      .catch((e) => {
        console.warn("[auth] initial getSession failed", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

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
