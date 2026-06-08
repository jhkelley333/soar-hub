import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Mail, Phone, ArrowRight, KeyRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth, SESSION_EXPIRED_KEY } from "@/auth/AuthProvider";
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

// Per-device "stay signed in" preference, set from the PWA login's
// checkbox and read by useIdleLogout to decide whether the installed app
// is exempt from the idle auto-logout. Absent = treated as on.
export const STAY_SIGNED_IN_KEY = "soar_stay_signed_in";

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

// ── Transient-failure retry ──────────────────────────────────────────────
// A flaky gateway / DNS hiccup makes an auth call fail for a few seconds and
// then recover on its own. Without help that reads as "Sign-in timed out" and
// the user panics. So we silently retry transient failures with a short
// backoff and show "Reconnecting…", turning a 15s blip into a non-event.
// Genuine auth failures (wrong password, etc.) are NOT transient — they come
// back fast and retrying would only delay the truth, so we surface them at
// once.
const AUTH_MAX_ATTEMPTS = 3;
const AUTH_BACKOFF_MS = [900, 2200]; // waits before attempts 2 and 3
const OFFLINE_MESSAGE =
  "Can't reach the server right now — check your connection and try again.";
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// True for network/DNS/timeout-class failures worth retrying; false for a
// real server response like bad credentials (4xx, except 429).
function isTransientAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; status?: number; message?: string };
  // supabase-js wraps fetch/DNS failures as AuthRetryableFetchError.
  if (e.name === "AuthRetryableFetchError") return true;
  const status = typeof e.status === "number" ? e.status : undefined;
  if (status !== undefined && (status === 0 || status === 429 || status >= 500)) return true;
  const msg = (e.message || "").toLowerCase();
  return /failed to fetch|networkerror|network error|load failed|timed out|fetch failed|network request failed|err_name_not_resolved|err_network|connection/.test(
    msg
  );
}

// Run an auth op (which resolves to `{ error }` or throws) with retry on
// transient failures. `onReconnecting` fires before each backoff so the UI
// can show a reconnecting state. Throws OFFLINE_MESSAGE once retries are
// exhausted on a transient failure; rethrows real errors immediately.
async function withAuthRetry<T extends { error: unknown }>(
  op: () => Promise<T>,
  onReconnecting: () => void
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await op();
      if (result.error && isTransientAuthError(result.error)) {
        if (attempt >= AUTH_MAX_ATTEMPTS) throw new Error(OFFLINE_MESSAGE);
        onReconnecting();
        await delay(AUTH_BACKOFF_MS[attempt - 1] ?? 2200);
        continue;
      }
      return result; // success, or a terminal auth error the caller will throw
    } catch (err) {
      if (isTransientAuthError(err)) {
        if (attempt >= AUTH_MAX_ATTEMPTS) throw new Error(OFFLINE_MESSAGE);
        onReconnecting();
        await delay(AUTH_BACKOFF_MS[attempt - 1] ?? 2200);
        continue;
      }
      throw err; // terminal (bad credentials, validation, etc.)
    }
  }
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
  // Set while withAuthRetry is mid-backoff after a transient failure, so the
  // button reads "Reconnecting…" instead of erroring out.
  const [reconnecting, setReconnecting] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Email-OTP ("magic") state. Once the code is sent we swap the form to a
  // code-entry step and verify in-app — no link to click, so the installed
  // PWA never has to hand off to the browser to finish sign-in.
  const [codeSent, setCodeSent] = useState(false);
  const [codeEmail, setCodeEmail] = useState("");
  const [code, setCode] = useState("");
  // PWA layout extras.
  const [showPassword, setShowPassword] = useState(false);
  // "Stay signed in on this device" — persisted as a per-device pref that
  // useIdleLogout reads: when ON (default) the installed app is treated as
  // a trusted device and skips the idle auto-logout; when OFF, the idle
  // logout applies even in standalone (e.g. a shared store tablet).
  const [staySignedIn, setStaySignedIn] = useState(
    () => localStorage.getItem(STAY_SIGNED_IN_KEY) !== "0"
  );

  // Surface AuthProvider's OAuth no-profile bounce (?error=no_profile).
  // Driven via the URL so the redirect can land here cleanly without
  // any in-memory state plumbing across the OAuth handoff.
  const queryError = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get("error");
  }, [location.search]);

  const detected = useMemo(() => detectMode(identifier), [identifier]);
  const standalone = useMemo(() => isStandalonePWA(), []);

  // AuthProvider sets this when the user was logged out involuntarily (a
  // dead token refresh), so explain it once rather than dropping them on
  // a bare login form. One-shot: clear it as we read it.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
        sessionStorage.removeItem(SESSION_EXPIRED_KEY);
        setInfo("Your session expired. Please sign in again.");
      }
    } catch {
      /* storage unavailable — nothing to surface */
    }
  }, []);

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

  // Fires before each retry backoff to flip the form into "Reconnecting…".
  function onReconnecting() {
    setReconnecting(true);
    setInfo("Connection looks slow — reconnecting…");
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    setSubmitting(true);
    setReconnecting(false);
    setError(null);
    setInfo(null);
    try {
      const resolved = await resolveIdentifier(identifier);
      if ("error" in resolved) throw new Error(resolved.error);
      const email = resolved.email;

      if (mode === "password") {
        const { error } = await withAuthRetry(
          () =>
            withTimeout(
              supabase.auth.signInWithPassword({ email, password }),
              "Sign-in",
              SIGN_IN_TIMEOUT_MS
            ),
          onReconnecting
        );
        if (error) throw error;
      } else if (mode === "magic") {
        const { error } = await withAuthRetry(
          () =>
            withTimeout(
              supabase.auth.signInWithOtp({
                email,
                // emailRedirectTo keeps the magic LINK in the email working
                // for browser users; PWA users use the code below instead.
                options: { emailRedirectTo: window.location.origin },
              }),
              "Email code",
              SIGN_IN_TIMEOUT_MS
            ),
          onReconnecting
        );
        if (error) throw error;
        setCodeEmail(email);
        setCodeSent(true);
        setInfo("We emailed you a sign-in code. Enter it below to continue.");
      } else {
        // forgot
        const { error } = await withAuthRetry(
          () =>
            withTimeout(
              supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
              }),
              "Reset request",
              SIGN_IN_TIMEOUT_MS
            ),
          onReconnecting
        );
        if (error) throw error;
        setInfo(
          "If an account exists for that contact, a password reset link has been emailed."
        );
      }
    } catch (err) {
      setInfo(null); // clear any "reconnecting…" hint before showing the error
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
      setReconnecting(false);
    }
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setReconnecting(false);
    setError(null);
    try {
      const { error } = await withAuthRetry(
        () =>
          withTimeout(
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
          ),
        onReconnecting
      );
      if (error) throw error;
    } catch (err) {
      setInfo(null);
      setError(
        err instanceof Error
          ? err.message
          : "That code didn't work. Check it or resend a new one."
      );
    } finally {
      setSubmitting(false);
      setReconnecting(false);
    }
  }

  function resetCodeStep() {
    setCodeSent(false);
    setCode("");
    setError(null);
    setInfo(null);
  }

  function updateStaySignedIn(next: boolean) {
    setStaySignedIn(next);
    try {
      localStorage.setItem(STAY_SIGNED_IN_KEY, next ? "1" : "0");
    } catch {
      /* storage disabled — pref just won't persist */
    }
  }

  // Show a phone or envelope icon next to the input as a confidence signal.
  const Icon =
    detected === "email" ? Mail : detected === "phone" ? Phone : null;
  const onCodeStep = mode === "magic" && codeSent;

  // ── Installed-PWA login ─────────────────────────────────────────────
  // Dark, app-style layout for the installed app. Same handlers/state as
  // the desktop card below; just a different presentation tuned for a
  // phone in standalone mode. Google SSO is intentionally absent here —
  // OAuth bounces out to Safari and never returns to the standalone app,
  // so the reliable above-store path is the in-app email code.
  if (standalone) {
    const darkField =
      "mt-2 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 py-3 text-[15px] text-white placeholder-white/30 outline-none transition focus:border-sky-400/60 focus:bg-white/[0.09]";
    const darkLabel =
      "text-[11px] font-semibold uppercase tracking-wide text-sky-300/80";
    return (
      <div
        className="relative flex min-h-full flex-col px-6 py-10 text-white"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, #34618a 0%, #173049 42%, #0a1726 100%)",
        }}
      >
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
          {/* Brand */}
          <div className="mb-8 mt-6 flex flex-col items-center text-center">
            <CupPlaceholder />
            <div className="mt-3 text-lg font-bold uppercase tracking-[0.2em]">
              SOAR <span className="font-light text-sky-200/90">Field App</span>
            </div>
            <h1 className="mt-6 text-[26px] font-semibold leading-tight">
              {mode === "forgot" ? "Reset password" : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-sky-200/70">
              {mode === "forgot"
                ? "We'll email you a reset link."
                : onCodeStep
                  ? `Enter the code we sent to ${codeEmail}.`
                  : mode === "magic"
                    ? "We'll email you a sign-in code."
                    : "Sign in with your phone or email."}
            </p>
          </div>

          {queryError === "no_profile" && (
            <div className="mb-5 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              That Google account isn't authorized yet. Sign in with your work
              email + password, or ask an admin to invite you.
            </div>
          )}

          <form
            onSubmit={onCodeStep ? handleVerifyCode : handleSubmit}
            className="space-y-4"
          >
            {onCodeStep ? (
              <div>
                <label htmlFor="otp-pwa" className={darkLabel}>
                  Verification code
                </label>
                <input
                  id="otp-pwa"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  maxLength={10}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  placeholder="Enter code"
                  className={`${darkField} text-center text-lg tracking-[0.4em]`}
                />
              </div>
            ) : (
              <div>
                <label htmlFor="id-pwa" className={darkLabel}>
                  Phone or email
                </label>
                <input
                  id="id-pwa"
                  type="text"
                  inputMode={detected === "phone" ? "tel" : "email"}
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="(555) 555-1234 or you@company.com"
                  className={darkField}
                />
              </div>
            )}

            {mode === "password" && (
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="pw-pwa" className={darkLabel}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setInfo(null);
                    }}
                    className="text-xs font-medium text-sky-300 hover:text-sky-200"
                  >
                    Forgot?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="pw-pwa"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${darkField} pr-16`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-sky-300 hover:text-sky-200"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            )}

            {mode === "password" && (
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={staySignedIn}
                  onChange={(e) => updateStaySignedIn(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/10 text-sky-500 focus:ring-sky-400/40"
                />
                Stay signed in on this device
              </label>
            )}

            {error && (
              <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-sky-100">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f72e0] py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-sky-950/40 transition hover:bg-[#2864c9] disabled:opacity-60"
            >
              {reconnecting
                ? "Reconnecting…"
                : submitting
                ? "Working…"
                : mode === "forgot"
                  ? "Send reset link"
                  : onCodeStep
                    ? "Verify & sign in"
                    : mode === "magic"
                      ? "Send code"
                      : "Sign in"}
              {!submitting && mode === "password" && (
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              )}
            </button>
          </form>

          {/* Secondary path: in-app email code (stands in for SSO, which
              can't complete inside the installed app). */}
          {mode === "password" && (
            <>
              <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-widest text-white/30">
                <span className="h-px flex-1 bg-white/10" />
                or
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode("magic");
                  setError(null);
                  setInfo(null);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] py-3.5 text-[15px] font-medium text-white transition hover:bg-white/[0.08]"
              >
                <KeyRound className="h-4 w-4" strokeWidth={2} />
                Email me a sign-in code
              </button>
            </>
          )}

          {onCodeStep && (
            <div className="mt-4 flex items-center justify-between text-xs font-medium text-sky-300/80">
              <button
                type="button"
                onClick={resetCodeStep}
                className="hover:text-sky-200"
              >
                Use a different email
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="hover:text-sky-200 disabled:opacity-50"
              >
                Resend code
              </button>
            </div>
          )}

          <div className="mt-6 text-center text-sm">
            {mode === "magic" && (
              <button
                type="button"
                onClick={() => {
                  setMode("password");
                  setCodeSent(false);
                  setCode("");
                  setError(null);
                  setInfo(null);
                }}
                className="font-medium text-sky-300 hover:text-sky-200"
              >
                Use a password instead
              </button>
            )}
            {mode === "forgot" && (
              <button
                type="button"
                onClick={() => {
                  setMode("password");
                  setError(null);
                  setInfo(null);
                }}
                className="font-medium text-sky-300 hover:text-sky-200"
              >
                Back to sign in
              </button>
            )}
            {mode === "password" && (
              <button
                type="button"
                onClick={() =>
                  setInfo("Can't sign in? Contact your administrator for help.")
                }
                className="font-medium text-sky-300/80 hover:text-sky-200"
              >
                Trouble signing in?
              </button>
            )}
          </div>

          <div className="mt-auto pt-10 text-center text-[11px] font-medium uppercase tracking-[0.2em] text-white/30">
            SOAR QSR
          </div>
        </div>
      </div>
    );
  }

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
            {mode === "magic" && !codeSent && "We'll email you a sign-in code."}
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
                <Label htmlFor="otp">Verification code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  maxLength={10}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  placeholder="Enter code"
                  className="tracking-[0.3em] text-center text-lg"
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
              {reconnecting && "Reconnecting…"}
              {!reconnecting && submitting && "Working…"}
              {!reconnecting && !submitting && mode === "password" && "Sign in"}
              {!reconnecting && !submitting && mode === "magic" && !codeSent && "Send code"}
              {!reconnecting && !submitting && mode === "magic" && codeSent && "Verify & sign in"}
              {!reconnecting && !submitting && mode === "forgot" && "Send reset link"}
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
