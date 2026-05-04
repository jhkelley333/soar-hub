import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";

/**
 * /reset-password — landing page for Supabase recovery emails.
 *
 * Note on the lock workaround: after a PASSWORD_RECOVERY event fires,
 * supabase-js holds an internal navigator.locks reservation on the
 * session that isn't always released before the next call needs it.
 * That can leave the promise returned by updateUser({ password })
 * pending forever — the server PUT actually succeeds and a USER_UPDATED
 * event fires, but the awaited promise never resolves.
 *
 * To work around it we fire updateUser without awaiting it, and treat
 * the USER_UPDATED auth event (or an explicit error response) as the
 * authoritative success/failure signal. A 15s timeout protects against
 * the (rare) case where neither resolves.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryReady(true);
    });
    if (window.location.hash.includes("type=recovery")) setRecoveryReady(true);
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);

    // Listen for the USER_UPDATED event before firing the call — if the
    // event arrives before the promise resolves (the deadlock case), we
    // still progress.
    const result = await new Promise<{ ok: boolean; message?: string }>(
      (resolve) => {
        let settled = false;
        const finish = (r: { ok: boolean; message?: string }) => {
          if (settled) return;
          settled = true;
          sub.subscription.unsubscribe();
          clearTimeout(timer);
          resolve(r);
        };

        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
          if (event === "USER_UPDATED") finish({ ok: true });
        });

        const timer = setTimeout(
          () => finish({ ok: false, message: "Password update timed out." }),
          15000
        );

        // Fire-and-forget. If the promise DOES resolve we still want the
        // result (it carries explicit errors); if it never resolves the
        // event listener takes over.
        supabase.auth
          .updateUser({ password })
          .then(({ error: updErr }) => {
            if (updErr) finish({ ok: false, message: updErr.message });
          })
          .catch((err) => {
            finish({
              ok: false,
              message: err instanceof Error ? err.message : "Update failed.",
            });
          });
      }
    );

    if (!result.ok) {
      setError(result.message ?? "Password update failed.");
      setSubmitting(false);
      return;
    }

    setDone(true);
    supabase.auth.signOut({ scope: "local" }).catch(() => {});
    setTimeout(() => navigate("/login", { replace: true }), 1500);
    setSubmitting(false);
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-accent px-4 py-12 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(116,210,231,0.45),transparent_60%)]"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-white/80">
            SOAR QSR
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Operations Hub
          </h1>
        </div>
        <div className="rounded-xl bg-white p-8 text-zinc-900 shadow-2xl ring-1 ring-black/5">
          {done ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">
                Password updated
              </h2>
              <p className="mt-2 text-sm text-zinc-600">
                Redirecting to sign in…
              </p>
            </>
          ) : recoveryReady ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">
                Set a new password
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Pick something at least 8 characters long.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <div>
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <Button
                  type="submit"
                  variant="danger"
                  disabled={submitting}
                  className="w-full"
                >
                  {submitting ? "Saving…" : "Save password"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">
                Reset your password
              </h2>
              <p className="mt-2 text-sm text-zinc-600">
                Open the reset link from your email to set a new password.
                The link will expire after one use.
              </p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-6 text-xs font-medium text-zinc-500 transition hover:text-midnight"
              >
                Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
