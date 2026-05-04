import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    console.log("[reset] mount, hash=", window.location.hash);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      console.log("[reset] auth event:", event);
      if (event === "PASSWORD_RECOVERY") setRecoveryReady(true);
    });
    if (window.location.hash.includes("type=recovery")) setRecoveryReady(true);
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    console.log("[reset] submit start");
    setSubmitting(true);
    try {
      console.log("[reset] calling updateUser");
      const { data, error: updErr } = await supabase.auth.updateUser({ password });
      console.log("[reset] updateUser returned", { hasData: !!data, updErr });
      if (updErr) throw updErr;
      console.log("[reset] setting done=true");
      setDone(true);
      console.log("[reset] firing signOut");
      supabase.auth.signOut({ scope: "local" })
        .then(() => console.log("[reset] signOut done"))
        .catch((e) => console.log("[reset] signOut err", e));
      console.log("[reset] scheduling navigate");
      setTimeout(() => { console.log("[reset] navigating"); navigate("/login", { replace: true }); }, 1500);
      console.log("[reset] try block end");
    } catch (err) {
      console.log("[reset] catch", err);
      setError(err instanceof Error ? err.message : "Password update failed.");
    } finally {
      console.log("[reset] finally setSubmitting(false)");
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-accent px-4 py-12 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(116,210,231,0.45),transparent_60%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-white/80">SOAR QSR</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Operations Hub</h1>
        </div>
        <div className="rounded-xl bg-white p-8 text-zinc-900 shadow-2xl ring-1 ring-black/5">
          {done ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">Password updated</h2>
              <p className="mt-2 text-sm text-zinc-600">Redirecting to sign in…</p>
            </>
          ) : recoveryReady ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">Set a new password</h2>
              <p className="mt-1 text-sm text-zinc-500">Pick something at least 8 characters long.</p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <div>
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
                {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
                <Button type="submit" variant="danger" disabled={submitting} className="w-full">{submitting ? "Saving…" : "Save password"}</Button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-midnight">Reset your password</h2>
              <p className="mt-2 text-sm text-zinc-600">Open the reset link from your email to set a new password. The link will expire after one use.</p>
              <button type="button" onClick={() => navigate("/login")} className="mt-6 text-xs font-medium text-zinc-500 transition hover:text-midnight">Back to sign in</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
