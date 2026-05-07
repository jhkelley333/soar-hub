import { useMemo, useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Mail, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { visibleNav } from "@/app/nav";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { detectMode, normalizePhone } from "@/lib/phone";
import type { UserRole } from "@/types/database";

// Always-allowed destinations regardless of role. Anything else has to
// match a nav entry the user can actually see.
const ALWAYS_ALLOWED = new Set(["/", "/account"]);

// Validate the `from` path captured by ProtectedRoute before redirecting
// to it post-login. After a deploy, a stale `from` (e.g. /paf when the
// user is now a shift_manager) can land them on a page they can't see,
// with an empty sidebar while profile is briefly null. Falling back to
// "/" if the path isn't in the user's allowed nav avoids that.
function safeRedirectTarget(from: string | null | undefined, role: UserRole): string {
  if (!from) return "/";
  if (ALWAYS_ALLOWED.has(from)) return from;
  const allowed = visibleNav(role);
  const ok = allowed.some(
    (item) => from === item.to || from.startsWith(item.to + "/")
  );
  return ok ? from : "/";
}

type Mode = "password" | "magic" | "forgot";

// Hard ceiling on auth network calls. supabase-js can rarely deadlock
// on a request that never resolves; without this the sign-in button
// stays "Working…" forever. 10s is generous on bad networks but
// short enough that users get a real error instead of a frozen UI.
const SIGN_IN_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, label: string, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out — try again.`)), ms)
    ),
  ]);
}

// Resolve a phone-or-email identifier to the canonical email Supabase auth
// expects. For email input we pass through; for phone we ping the public
// auth-resolve function which looks up the matching profile by phone and
// returns its email (or 404).
async function resolveIdentifier(input: string): Promise<{ email: string } | { error: string }> {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Enter your phone or email." };

  if (detectMode(trimmed) === "email") {
    return { email: trimmed };
  }

  const phone = normalizePhone(trimmed);
  if (!phone) return { error: "That doesn't look like a 10-digit phone number." };

  try {
    const res = await fetch(
      `/.netlify/functions/auth-resolve?phone=${encodeURIComponent(phone)}`
    );
    if (res.status === 404) {
      return { error: "We couldn't find an account with that phone." };
    }
    if (!res.ok) {
      return { error: "Sign-in is temporarily unavailable. Try again." };
    }
    const body = (await res.json()) as { email?: string; error?: string };
    if (!body.email) return { error: body.error ?? "Lookup failed." };
    return { email: body.email };
  } catch {
    return { error: "Network error. Try again." };
  }
}

export function LoginPage() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const detected = useMemo(() => detectMode(identifier), [identifier]);

  // Wait for BOTH session and profile before navigating away. Without
  // profile the role-aware safeRedirectTarget can't validate, and the
  // sidebar would render empty (visibleNav([]) returns nothing).
  if (!loading && session && profile) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname;
    return <Navigate to={safeRedirectTarget(from, profile.role)} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const resolved = await resolveIdentifier(identifier);
      if ("error" in resolved) throw new Error(resolved.error);
      const email = resolved.email;

      if (mode === "password") {
        const { error } = await withTimeout(
          supabase.auth.signInWithPassword({ email, password }),
          "Sign-in",
          SIGN_IN_TIMEOUT_MS
        );
        if (error) throw error;
      } else if (mode === "magic") {
        const { error } = await withTimeout(
          supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: window.location.origin },
          }),
          "Magic link",
          SIGN_IN_TIMEOUT_MS
        );
        if (error) throw error;
        setInfo("Check your email for a sign-in link.");
      } else {
        // forgot
        const { error } = await withTimeout(
          supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
          }),
          "Reset request",
          SIGN_IN_TIMEOUT_MS
        );
        if (error) throw error;
        setInfo(
          "If an account exists for that contact, a password reset link has been emailed."
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  // Show a phone or envelope icon next to the input as a confidence signal.
  const Icon =
    detected === "email" ? Mail : detected === "phone" ? Phone : null;

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-accent px-4 py-12 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(116,210,231,0.45),transparent_60%)]"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <CupPlaceholder />
          <div className="mt-4 text-xs font-semibold uppercase tracking-[0.25em] text-white/80">
            SOAR QSR
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Operations Hub
          </h1>
          <p className="mt-1 text-sm text-white/80">
            Solutions That Accelerate Growth
          </p>
        </div>

        <div className="rounded-xl bg-white p-8 text-zinc-900 shadow-2xl ring-1 ring-black/5">
          <h2 className="text-xl font-semibold tracking-tight text-midnight">
            {mode === "forgot" ? "Reset password" : "Sign in"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {mode === "password" && "Use your phone or email and password."}
            {mode === "magic" && "We'll email you a sign-in link."}
            {mode === "forgot" &&
              "Enter your phone or email and we'll send a reset link."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <Label htmlFor="identifier">Phone number or email</Label>
              <div className="relative">
                <Input
                  id="identifier"
                  type="text"
                  inputMode={detected === "email" ? "email" : "tel"}
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="(555) 555-1234 or you@company.com"
                  className={Icon ? "pr-9" : undefined}
                />
                {Icon && (
                  <Icon
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                    strokeWidth={1.75}
                  />
                )}
              </div>
            </div>

            {mode === "password" && (
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                {info}
              </div>
            )}

            <Button type="submit" variant="danger" disabled={submitting} className="w-full">
              {submitting && "Working…"}
              {!submitting && mode === "password" && "Sign in"}
              {!submitting && mode === "magic" && "Send link"}
              {!submitting && mode === "forgot" && "Send reset link"}
            </Button>
          </form>

          <div className="mt-6 flex flex-col items-start gap-3 text-xs font-medium text-zinc-500">
            {mode !== "forgot" && (
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setInfo(null);
                  setPassword("");
                }}
                className="transition hover:text-midnight"
              >
                Forgot password?
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (mode === "forgot") {
                  setMode("password");
                } else {
                  setMode((m) => (m === "password" ? "magic" : "password"));
                }
                setError(null);
                setInfo(null);
              }}
              className="transition hover:text-midnight"
            >
              {mode === "password" && "Use a magic link instead"}
              {mode === "magic" && "Use a password instead"}
              {mode === "forgot" && "Back to sign in"}
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-white/70">
          Trouble signing in? Contact your administrator.
        </p>
      </div>
    </div>
  );
}

function CupPlaceholder() {
  return (
    <svg
      viewBox="0 0 64 80"
      width="72"
      height="90"
      role="img"
      aria-label="Drink cup placeholder"
      className="drop-shadow-md"
    >
      <rect x="8" y="12" width="48" height="8" rx="2" fill="white" opacity="0.95" />
      <rect x="36" y="2" width="6" height="14" rx="1.5" fill="white" opacity="0.8" />
      <path
        d="M12 22 L52 22 L46 74 Q46 78 42 78 L22 78 Q18 78 18 74 Z"
        fill="white"
        opacity="0.95"
      />
      <path
        d="M14 38 L50 38 L48.6 50 L15.4 50 Z"
        fill="#E40046"
        opacity="0.85"
      />
    </svg>
  );
}
