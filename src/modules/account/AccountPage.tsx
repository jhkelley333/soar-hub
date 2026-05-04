import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { ROLE_LABELS } from "@/types/database";
import { formatPhoneForDisplay, normalizePhone } from "@/lib/phone";

export function AccountPage() {
  const { profile, refresh } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);

  // Hydrate the form when the profile loads (or changes).
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setPhone(profile.phone ? formatPhoneForDisplay(profile.phone) : "");
    }
  }, [profile]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Not signed in");
      let normalizedPhone: string | null = null;
      if (phone.trim() !== "") {
        normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) throw new Error("Phone must be a 10-digit number.");
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim() || null,
          phone: normalizedPhone,
        })
        .eq("id", profile.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.push("Profile saved.", "success");
      await refresh();
      qc.invalidateQueries({ queryKey: ["my-team"] });
    },
    onError: (e: unknown) =>
      setProfileError(e instanceof Error ? e.message : "Save failed."),
  });

  function submitProfile(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);
    saveProfile.mutate();
  }

  return (
    <>
      <PageHeader
        title="My Account"
        description="Update your contact info and password."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <form onSubmit={submitProfile} className="space-y-4">
              <div>
                <Label htmlFor="acct-email">Email</Label>
                <Input
                  id="acct-email"
                  value={profile?.email ?? ""}
                  disabled
                  readOnly
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Email is managed by an Admin. Contact yours to change it.
                </p>
              </div>
              <div>
                <Label htmlFor="acct-name">Full name</Label>
                <Input
                  id="acct-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="acct-phone">Phone</Label>
                <Input
                  id="acct-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 555-1234"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Used as a sign-in identifier in addition to email.
                </p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-zinc-500">
                  Role:{" "}
                  <span className="font-medium text-zinc-700">
                    {profile ? ROLE_LABELS[profile.role] : "—"}
                  </span>{" "}
                  {profile?.role === "payroll" && (
                    <Badge tone="info">Cross-org</Badge>
                  )}
                </div>
                <Button type="submit" disabled={saveProfile.isPending}>
                  {saveProfile.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
              {profileError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {profileError}
                </div>
              )}
            </form>
          </CardBody>
        </Card>

        <PasswordCard />
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------
// Password card — re-auth with current password, then update.
// ----------------------------------------------------------------------------

function PasswordCard() {
  const { profile } = useAuth();
  const toast = useToast();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!profile) {
      setError("Not signed in.");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    if (next === current) {
      setError("New password must be different from the current one.");
      return;
    }
    setSubmitting(true);
    try {
      // Re-auth with the current password before allowing a change.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: current,
      });
      if (signInErr) throw new Error("Current password is incorrect.");

      // Same lock-deadlock guard as ResetPasswordPage: race updateUser
      // against the USER_UPDATED auth event so we don't hang if
      // supabase-js orphans its session lock.
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
            () => finish({ ok: false, message: "Update timed out." }),
            15000
          );
          supabase.auth
            .updateUser({ password: next })
            .then(({ error: updErr }) => {
              if (updErr) finish({ ok: false, message: updErr.message });
            })
            .catch((err) => {
              finish({
                ok: false,
                message:
                  err instanceof Error ? err.message : "Update failed.",
              });
            });
        }
      );

      if (!result.ok) throw new Error(result.message ?? "Update failed.");

      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.push("Password updated.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password update failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Password" />
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="acct-current">Current password</Label>
            <Input
              id="acct-current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="acct-next">New password</Label>
            <Input
              id="acct-next"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="acct-confirm">Confirm new password</Label>
            <Input
              id="acct-confirm"
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
          {done && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              Password updated.
            </div>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Updating…" : "Update password"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
