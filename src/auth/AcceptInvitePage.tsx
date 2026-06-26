import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";

/**
 * /accept-invite — landing page for Supabase invite emails.
 *
 * Flow:
 *   1. Manager invites a user via My Team. Supabase sends an email with a
 *      magic-link recovery token (type=invite).
 *   2. The link opens this page (or the root, where main.tsx defensively
 *      redirects here if it sees type=invite in the hash).
 *   3. detectSessionInUrl picks up the access_token and fires INITIAL_SESSION.
 *      The user is now authenticated, but with no password on file.
 *   4. We force them to set a password before letting them into the app.
 *      Same lock-deadlock workaround as ResetPasswordPage: don't await
 *      updateUser; resolve on the USER_UPDATED auth event.
 *
 * Edge cases:
 *   - Direct visit to /accept-invite without a token: show generic
 *     "open the invite link from your email" message.
 *   - Already-set password (e.g. user clicked an old invite): same
 *     graceful message — they can navigate to /login.
 */
export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Treat both INITIAL_SESSION (fresh detectSessionInUrl pickup) and
    // SIGNED_IN as proof the invite token is good. PASSWORD_RECOVERY
    // can also fire if the project is configured that way.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        (event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "PASSWORD_RECOVERY") &&
        session
      ) {
        if (!cancelled) setReady(true);
      }
    });
    // Also handle the case where detectSessionInUrl already ran and set
    // a session before we subscribed.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !cancelled) setReady(true);
    });

    // If no session arrives within ~8s, the token exchange failed silently —
    // almost always because the invite link was already used (a fresh re-invite
    // invalidates the prior link, so the old email's link is now dead) or
    // expired. Surface a clear, actionable message instead of leaving the user
    // on a form that will fail with "Auth session missing!" on submit. We
    // intentionally DO NOT setReady(true) based on the URL hash alone, because
    // a spent/expired token still ships a "type=invite" hash but produces no
    // session — and that was the path leading to the cryptic submit error.
    const expiredTimer = window.setTimeout(async () => {
      if (cancelled) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setError(
          "This invite link is no longer valid. It may have expired or been replaced by a newer one — ask your manager to send a fresh invite and use that email.",
        );
      }
    }, 8000);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      window.clearTimeout(expiredTimer);
    };
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
          () => finish({ ok: false, message: "Setup timed out." }),
          15000
        );
        const friendly = (msg: string | undefined) =>
          /auth session missing/i.test(msg || "")
            ? "Your invite link is no longer valid. It may have expired or been replaced by a newer one — ask your manager to send a fresh invite and use that email."
            : msg || "Setup failed.";
        supabase.auth
          .updateUser({ password })
          .then(({ error: updErr }) => {
            if (updErr) finish({ ok: false, message: friendly(updErr.message) });
          })
          .catch((err) => {
            finish({
              ok: false,
              message: friendly(err instanceof Error ? err.message : undefined),
            });
          });
      }
    );

    if (!result.ok) {
      setError(result.message ?? "Setup failed.");
      setSubmitting(false);
      return;
    }

    setDone(true);
    // Sign out locally so they re-authenticate with the new password.
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
          <p className="mt-1 text-sm text-white/80">
            Welcome — let's get you set up.
          </p>
        </div>
        <div className="rounded-xl bg-white p-8 text-zinc-900 shadow-2xl ring-1 ring-black/5">
          {done ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">
                Account ready
              </h2>
              <p className="mt-2 text-sm text-zinc-600">
                Redirecting to sign in…
              </p>
            </>
          ) : ready ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">
                Choose a password
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                You'll use this with your email or phone to sign in.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <div>
                  <Label htmlFor="new-password">Password</Label>
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
                  {submitting ? "Saving…" : "Create account"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">
                {error ? "Invite link no longer valid" : "Accept your invite"}
              </h2>
              <p className="mt-2 text-sm text-zinc-600">
                {error ??
                  "Open the invite link from your email to set up your account. The link will expire after one use."}
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
