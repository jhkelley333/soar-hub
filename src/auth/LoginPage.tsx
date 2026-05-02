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
    <div className="flex min-h-full items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-midnight text-sm font-semibold tracking-tight text-white">
            S
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-midnight">SOAR Hub</div>
            <div className="text-xs text-zinc-500">Operations Platform</div>
          </div>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-midnight">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {mode === "password" ? "Use your work email and password." : "We'll email you a sign-in link."}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
    </div>
  );
}
