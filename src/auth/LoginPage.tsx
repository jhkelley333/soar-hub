import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";

type Mode = "password" | "magic";

export function LoginPage() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!loading && session) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setInfo("Check your email for a sign-in link.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-accent px-4 py-12 text-white">
      {/* Decorative blue depth — soft radial highlight behind the brand block */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(116,210,231,0.45),transparent_60%)]"
      />

      <div className="relative w-full max-w-md">
        {/* Brand block above the card */}
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

        {/* White sign-in card */}
        <div className="rounded-xl bg-white p-8 text-zinc-900 shadow-2xl ring-1 ring-black/5">
          <h2 className="text-xl font-semibold tracking-tight text-midnight">
            Sign in
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {mode === "password"
              ? "Use your work email and password."
              : "We'll email you a sign-in link."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
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
              {submitting ? "Working..." : mode === "password" ? "Sign in" : "Send link"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "password" ? "magic" : "password"));
              setError(null);
              setInfo(null);
            }}
            className="mt-6 text-xs font-medium text-zinc-500 transition hover:text-midnight"
          >
            {mode === "password" ? "Use a magic link instead" : "Use a password instead"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-white/70">
          Trouble signing in? Contact your administrator.
        </p>
      </div>
    </div>
  );
}

// Inline SVG placeholder of a takeaway cup. Swap with a real Sonic asset
// (PNG/SVG dropped into /public) when one is available — keep the same
// dimensions and the rest of the layout will stay put.
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
      {/* Lid */}
      <rect
        x="8"
        y="12"
        width="48"
        height="8"
        rx="2"
        fill="white"
        opacity="0.95"
      />
      {/* Straw */}
      <rect
        x="36"
        y="2"
        width="6"
        height="14"
        rx="1.5"
        fill="white"
        opacity="0.8"
      />
      {/* Cup body */}
      <path
        d="M12 22 L52 22 L46 74 Q46 78 42 78 L22 78 Q18 78 18 74 Z"
        fill="white"
        opacity="0.95"
      />
      {/* Subtle stripe band */}
      <path
        d="M14 38 L50 38 L48.6 50 L15.4 50 Z"
        fill="#E40046"
        opacity="0.85"
      />
    </svg>
  );
}
