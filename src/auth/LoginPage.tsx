import { useMemo, useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Mail, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { defaultLandingPath, visibleNav } from "@/app/nav";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { detectMode, normalizePhone } from "@/lib/phone";
import type { UserRole } from "@/types/database";

// Always-allowed destinations regardless of role. Anything else has to
// match a nav entry the user can actually see.
const ALWAYS_ALLOWED = new Set(["/", "/account"]);

// Detect installed-PWA / standalone display. In standalone mode on iOS,
// signInWithOAuth bounces the user out to Safari for accounts.google.com
// and they never make it back to the standalone app — they land in
// Safari with the full URL bar. We hide the Google button in that mode
// and steer them to email-based sign-in instead.
function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)");
  if (mql?.matches) return true;
  // iOS Safari predates display-mode and uses a non-standard flag.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

// Validate the `from` path captured by ProtectedRoute before redirecting
// to it post-login. After a deploy, a stale `from` (e.g. /paf when the
// user is now a shift_manager) can land them on a page they can't see,
// with an empty sidebar while profile is briefly null. Falling back to
// the role's default landing path if the captured `from` isn't in the
// user's allowed nav avoids that.
function safeRedirectTarget(from: string | null | undefined, role: UserRole): string {
  const fallback = defaultLandingPath(role);
  if (!from) return fallback;
  // Reject anything that isn't an in-app same-origin path. "//evil.com"
  // is a protocol-relative URL the browser would resolve off-origin;
  // requiring a single leading slash keeps redirects local.
  if (!from.startsWith("/") || from.startsWith("//")) return fallback;
  if (ALWAYS_ALLOWED.has(from)) {
    // Even "/" should fall through to the role default if the role
    // can't actually use the dashboard (payroll).
    if (from === "/" && role === "payroll") return fallback;
    return from;
  }
  const allowed = visibleNav(role);
  const ok = allowed.some(
    (item) => from === item.to || from.startsWith(item.to + "/")
  );
  return ok ? from : fallback;
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
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Email-OTP ("magic") state. Once the code is sent we swap the form to a
  // code-entry step and verify in-app — no link to click, so the installed
  // PWA never has to hand off to the browser to finish sign-in.
  const [codeSent, setCodeSent] = useState(false);
  const [codeEmail, setCodeEmail] = useState("");
  const [code, setCode] = useState("");

  // Surface AuthProvider's OAuth no-profile bounce (?error=no_profile).
  // Driven via the URL so the redirect can land here cleanly without
  // any in-memory state plumbing across the OAuth handoff.
  const queryError = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get("error");
  }, [location.search]);

  const detected = useMemo(() => detectMode(identifier), [identifier]);
  const standalone = useMemo(() => isStandalonePWA(), []);

  async function handleGoogle() {
    setGooglePending(true);
    setError(null);
    setInfo(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            // Hint Google's consent screen toward your Workspace.
            // soarqsr.com is the actual Workspace domain where humans
            // have accounts (hkelley@soarqsr.com etc.). mysoarhub.com
            // is the app's email domain, not a sign-in directory.
            // Override via VITE_GOOGLE_HOSTED_DOMAIN env var if your
            // Workspace lives elsewhere.
            hd: import.meta.env.VITE_GOOGLE_HOSTED_DOMAIN || "soarqsr.com",
            // Always show the account picker — important when users
            // are signed into multiple Google accounts in the browser.
            prompt: "select_account",
          },
        },
      });
      if (error) throw error;
      // signInWithOAuth redirects the browser; this line won't run
      // in the happy path. If it does (no redirect), supabase-js
      // already cleared session and we just stop showing pending.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
      setGooglePending(false);
    }
  }

  // Wait for BOTH session and profile before navigating away. Without
  // profile the role-aware safeRedirectTarget can't validate, and the
  // sidebar would render empty (visibleNav([]) returns nothing).
  if (!loading && session && profile) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname;
    return <Navigate to={safeRedirectTarget(from, profile.role)} replace />;
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
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
            // emailRedirectTo keeps the magic LINK in the email working
            // for browser users; PWA users use the code below instead.
            options: { emailRedirectTo: window.location.origin },
          }),
          "Email code",
          SIGN_IN_TIMEOUT_MS
        );
        if (error) throw error;
        setCodeEmail(email);
        setCodeSent(true);
        setInfo("We emailed you a 6-digit code. Enter it below to sign in.");
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

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { error } = await withTimeout(
        // Email-OTP sent via signInWithOtp verifies with type "email".
        // On success onAuthStateChange fires SIGNED_IN, AuthProvider
        // loads the profile, and the redirect at the top of this
        // component takes over — all without leaving the PWA.
        supabase.auth.verifyOtp({
          email: codeEmail,
          token: code.trim(),
          type: "email",
        }),
        "Code check",
        SIGN_IN_TIMEOUT_MS
      );
      if (error) throw error;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That code didn't work. Check it or resend a new one."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function resetCodeStep() {
    setCodeSent(false);
    setCode("");
    setError(null);
    setInfo(null);
  }

  // Show a phone or envelope icon next to the input as a confidence signal.
  const Icon =
    detected === "email" ? Mail : detected === "phone" ? Phone : null;
  const onCodeStep = mode === "magic" && codeSent;

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
            {mode === "magic" && !codeSent && "We'll email you a 6-digit code."}
            {mode === "magic" && codeSent && `Enter the code we sent to ${codeEmail}.`}
            {mode === "forgot" &&
              "Enter your phone or email and we'll send a reset link."}
          </p>

          {queryError === "no_profile" && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="font-semibold">Your Google account isn't authorized yet.</div>
              <div className="mt-0.5 text-xs">
                We don't have a profile for that email. Ask an admin to invite you,
                or sign in below with the email + password account that's already on file.
              </div>
            </div>
          )}

          <form
            onSubmit={onCodeStep ? handleVerifyCode : handleSubmit}
            className="mt-6 space-y-5"
          >
            {onCodeStep ? (
              <div>
                <Label htmlFor="otp">6-digit code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  maxLength={6}
                  pattern="\d{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="tracking-[0.4em] text-center text-lg"
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="identifier">Phone number or email</Label>
                <div className="relative">
                  <Input
                    id="identifier"
                    type="text"
                    inputMode={
                      detected === "email"
                        ? "email"
                        : detected === "phone"
                          ? "tel"
                          : "text"
                    }
                    autoComplete="username"
                    autoCapitalize="off"
                    spellCheck={false}
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
            )}

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
              {!submitting && mode === "magic" && !codeSent && "Send code"}
              {!submitting && mode === "magic" && codeSent && "Verify & sign in"}
              {!submitting && mode === "forgot" && "Send reset link"}
            </Button>
          </form>

          {onCodeStep && (
            <div className="mt-4 flex items-center justify-between text-xs font-medium text-zinc-500">
              <button
                type="button"
                onClick={resetCodeStep}
                className="transition hover:text-midnight"
              >
                Use a different email
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="transition hover:text-midnight disabled:opacity-50"
              >
                Resend code
              </button>
            </div>
          )}

          <div className="mt-6 flex flex-col items-start gap-3 text-xs font-medium text-zinc-500">
            {mode !== "forgot" && (
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setCodeSent(false);
                  setCode("");
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
                setCodeSent(false);
                setCode("");
                setError(null);
                setInfo(null);
              }}
              className="transition hover:text-midnight"
            >
              {mode === "password" && "Email me a code instead"}
              {mode === "magic" && "Use a password instead"}
              {mode === "forgot" && "Back to sign in"}
            </button>
          </div>

          {/* Above-store / corporate sign-in. Lives below the form
              and below the mode toggles so it doesn't compete with
              the GM + shift-manager flow at the top — phone +
              password is the primary path for floor staff.

              Hidden in standalone PWA mode: iOS bounces the OAuth
              redirect into Safari and the user never returns to the
              standalone app. We point them at email sign-in instead. */}
          {mode !== "forgot" && (
            <div className="mt-6 border-t border-zinc-100 pt-5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Above-store team
              </div>
              {standalone ? (
                <div className="mt-1 text-[11px] text-zinc-500">
                  Google sign-in isn't available inside the installed
                  app. Sign in with your work email above — or open the
                  site in Safari to use Google.
                </div>
              ) : (
                <>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    DOs, SDOs, and corporate users with a SOAR QSR Google
                    Workspace account.
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogle}
                    disabled={googlePending || submitting}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-midnight transition hover:bg-zinc-50 disabled:opacity-50"
                  >
                    <GoogleMark />
                    {googlePending ? "Redirecting to Google…" : "Continue with Google"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/70">
          Trouble signing in? Contact your administrator.
        </p>
      </div>
    </div>
  );
}

// Google "G" mark. SVG inlined so we don't pull in another icon set.
// Colors per Google's branding guidelines.
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
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
