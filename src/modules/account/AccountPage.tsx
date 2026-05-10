import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useBlocker } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Download, FileText, Trash2 } from "lucide-react";
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

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
const AVATAR_BUCKET = "avatars";
const CFM_BUCKET = "cfm-certs";
const AVATAR_MIME = ["image/jpeg", "image/png", "image/webp"];
const CFM_MIME = ["application/pdf", "image/jpeg", "image/png"];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const CFM_MAX_BYTES = 10 * 1024 * 1024;

export function AccountPage() {
  const { profile, refresh } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [fullName, setFullName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  // Only GMs see + can change this; everyone else is force-true.
  const [showBirthday, setShowBirthday] = useState(true);
  const [shirtSize, setShirtSize] = useState("");
  const [favoriteQuote, setFavoriteQuote] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Hydrate the form when the profile loads (or changes).
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setPreferredName(profile.preferred_name ?? "");
      setPhone(profile.phone ? formatPhoneForDisplay(profile.phone) : "");
      setBirthday(profile.birthday ?? "");
      setShowBirthday(profile.show_birthday ?? true);
      setShirtSize(profile.shirt_size ?? "");
      setFavoriteQuote(profile.favorite_quote ?? "");
    }
  }, [profile]);

  const dirty = useMemo(() => {
    if (!profile) return false;
    const phoneNormalized = phone.trim() === "" ? null : normalizePhone(phone);
    return (
      (fullName.trim() || null) !== (profile.full_name ?? null) ||
      (preferredName.trim() || null) !== (profile.preferred_name ?? null) ||
      phoneNormalized !== (profile.phone ?? null) ||
      (birthday || null) !== (profile.birthday ?? null) ||
      showBirthday !== (profile.show_birthday ?? true) ||
      (shirtSize || null) !== (profile.shirt_size ?? null) ||
      (favoriteQuote.trim() || null) !== (profile.favorite_quote ?? null)
    );
  }, [profile, fullName, preferredName, phone, birthday, showBirthday, shirtSize, favoriteQuote]);

  // Tab-close guard.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // In-app navigation guard.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return dirty && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (blocker.state === "blocked") {
      const ok = window.confirm(
        "You have unsaved changes to your profile. Leave without saving?"
      );
      if (ok) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);

  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

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
          preferred_name: preferredName.trim() || null,
          phone: normalizedPhone,
          birthday: birthday || null,
          // Force-true for non-GM roles regardless of state — only GMs
          // can opt out via the toggle below.
          show_birthday: profile.role === "gm" ? showBirthday : true,
          shirt_size: shirtSize || null,
          favorite_quote: favoriteQuote.trim() || null,
        })
        .eq("id", profile.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.push("Profile saved.", "success");
      setSavedAt(Date.now());
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
        description="Update your contact info, photo, and password."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <form onSubmit={submitProfile} className="space-y-4">
              <AvatarBlock />

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
                <Label htmlFor="acct-preferred">Preferred name</Label>
                <Input
                  id="acct-preferred"
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  placeholder={profile?.full_name?.split(" ")[0] ?? ""}
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
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="acct-birthday">Birthday</Label>
                  <Input
                    id="acct-birthday"
                    type="date"
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                  />
                  {profile?.role === "gm" && birthday && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={showBirthday}
                        onChange={(e) => setShowBirthday(e.target.checked)}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      Show my birthday on the team dashboard
                    </label>
                  )}
                </div>
                <div>
                  <Label htmlFor="acct-shirt">Shirt size</Label>
                  <select
                    id="acct-shirt"
                    value={shirtSize}
                    onChange={(e) => setShirtSize(e.target.value)}
                    className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="">—</option>
                    {SHIRT_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor="acct-quote">Favorite quote</Label>
                <textarea
                  id="acct-quote"
                  value={favoriteQuote}
                  onChange={(e) => setFavoriteQuote(e.target.value)}
                  rows={2}
                  maxLength={280}
                  className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Optional. Up to 280 characters.
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
                <div className="flex items-center gap-2">
                  {savedAt !== null && (
                    <Badge tone="success" className="inline-flex items-center gap-1">
                      <Check className="h-3 w-3" strokeWidth={2.5} />
                      Updated
                    </Badge>
                  )}
                  <Button
                    type="submit"
                    disabled={saveProfile.isPending || !dirty}
                  >
                    {saveProfile.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>
              {profileError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {profileError}
                </div>
              )}
            </form>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <CertifiedFoodManagerCard />
          <PasswordCard />
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------
// Avatar — upload + preview + remove. Public bucket so the saved URL works
// in any <img> without signed-URL plumbing. We append a cache-bust param
// after upload so the browser re-fetches.
// ----------------------------------------------------------------------------

function AvatarBlock() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const photoUrl = profile?.profile_photo_url ?? null;

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-picking same file fires onChange
    if (!file || !profile) return;

    if (!AVATAR_MIME.includes(file.type)) {
      toast.push("Photo must be JPG, PNG, or WEBP.", "error");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.push("Photo must be 5 MB or smaller.", "error");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${profile.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw new Error(upErr.message);

      const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const cacheBusted = `${pub.publicUrl}?v=${Date.now()}`;
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ profile_photo_url: cacheBusted })
        .eq("id", profile.id);
      if (dbErr) throw new Error(dbErr.message);
      await refresh();
      toast.push("Photo updated.", "success");
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : "Photo upload failed.",
        "error"
      );
    } finally {
      setUploading(false);
    }
  }

  async function onRemove() {
    if (!profile) return;
    if (!window.confirm("Remove your profile photo?")) return;
    setUploading(true);
    try {
      // Best-effort delete of the stored object — don't block on failure.
      const { error } = await supabase
        .from("profiles")
        .update({ profile_photo_url: null })
        .eq("id", profile.id);
      if (error) throw new Error(error.message);
      await refresh();
      toast.push("Photo removed.", "success");
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : "Couldn't remove photo.",
        "error"
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-400">
            {(profile?.preferred_name?.[0] ?? profile?.full_name?.[0] ?? "?").toUpperCase()}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <input
          ref={fileRef}
          type="file"
          accept={AVATAR_MIME.join(",")}
          className="hidden"
          onChange={onPick}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Camera className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            {uploading ? "Uploading…" : photoUrl ? "Change photo" : "Upload photo"}
          </Button>
          {photoUrl && !uploading && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-zinc-500">JPG / PNG / WEBP up to 5 MB.</p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Certified Food Manager card — number, issued date, computed expiry,
// and an optional file upload of the cert (PDF or image). The file is
// stored privately in the cfm-certs bucket; viewing it generates a
// short-lived signed URL.
// ----------------------------------------------------------------------------

function CertifiedFoodManagerCard() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [certNumber, setCertNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    if (profile) {
      setCertNumber(profile.cfm_cert_number ?? "");
      setIssuedAt(profile.cfm_issued_at ?? "");
    }
  }, [profile]);

  // Probe whether a stored cert file exists (lists the user's folder).
  // Re-fires on profile load and after each successful save (savedAt
  // becomes a number). Skips the savedAt → null transition that fires
  // 4 seconds later as part of the success-banner cleanup; that
  // transition was triggering a redundant storage list every save.
  const probedSavedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!profile) return;
    const isCleanupTransition =
      probedSavedAtRef.current !== null && savedAt === null;
    probedSavedAtRef.current = savedAt;
    if (isCleanupTransition) return;
    let cancelled = false;
    supabase.storage
      .from(CFM_BUCKET)
      .list(profile.id, { limit: 5 })
      .then(({ data }) => {
        if (cancelled) return;
        setHasFile((data ?? []).some((f) => f.name.startsWith("cfm.")));
      })
      .catch(() => {
        /* not fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [profile, savedAt]);

  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const expiresAt = profile?.cfm_expires_at ?? null;
  const expiryStatus = useMemo(() => {
    if (!expiresAt) return null;
    const now = new Date();
    const exp = new Date(expiresAt);
    const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) return { tone: "danger" as const, label: `Expired ${-days}d ago` };
    if (days <= 60) return { tone: "warning" as const, label: `Expires in ${days}d` };
    return { tone: "success" as const, label: `Valid (${days}d left)` };
  }, [expiresAt]);

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    if (!CFM_MIME.includes(f.type)) {
      setError("Cert must be PDF, JPG, or PNG.");
      return;
    }
    if (f.size > CFM_MAX_BYTES) {
      setError("Cert must be 10 MB or smaller.");
      return;
    }
    setError(null);
    setPendingFile(f);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    setUploading(true);
    try {
      // 1. Update DB row first so the metadata is live even if the upload fails.
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({
          cfm_cert_number: certNumber.trim() || null,
          cfm_issued_at: issuedAt || null,
        })
        .eq("id", profile.id);
      if (dbErr) throw new Error(dbErr.message);

      // 2. Upload the file if the user picked one.
      if (pendingFile) {
        const ext = pendingFile.name.split(".").pop()?.toLowerCase() ?? "pdf";
        const path = `${profile.id}/cfm.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(CFM_BUCKET)
          .upload(path, pendingFile, {
            upsert: true,
            contentType: pendingFile.type,
          });
        if (upErr) throw new Error(upErr.message);
        setPendingFile(null);
      }

      await refresh();
      setSavedAt(Date.now());
      toast.push("CFM certificate saved.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleViewFile() {
    if (!profile) return;
    // We don't know the file extension up front — list and pick the first
    // cfm.* entry.
    const { data } = await supabase.storage
      .from(CFM_BUCKET)
      .list(profile.id, { limit: 5 });
    const file = (data ?? []).find((f) => f.name.startsWith("cfm."));
    if (!file) {
      toast.push("No cert file on record.", "info");
      return;
    }
    const path = `${profile.id}/${file.name}`;
    const { data: signed, error } = await supabase.storage
      .from(CFM_BUCKET)
      .createSignedUrl(path, 60);
    if (error || !signed?.signedUrl) {
      toast.push("Couldn't open cert.", "error");
      return;
    }
    window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Card>
      <CardHeader
        title="Certified Food Manager"
        description="Cert number, issued date, and uploaded copy."
      />
      <CardBody>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <Label htmlFor="cfm-number">Certification number</Label>
            <Input
              id="cfm-number"
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              placeholder="e.g. 12345678"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cfm-issued">Issued date</Label>
              <Input
                id="cfm-issued"
                type="date"
                value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cfm-expires">Expires</Label>
              <Input
                id="cfm-expires"
                value={expiresAt ?? "—"}
                disabled
                readOnly
              />
              {expiryStatus && (
                <div className="mt-1">
                  <Badge tone={expiryStatus.tone}>{expiryStatus.label}</Badge>
                </div>
              )}
              <p className="mt-1 text-xs text-zinc-500">
                Auto-computed: issued date + 5 years.
              </p>
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-zinc-700">
                <FileText className="h-4 w-4" strokeWidth={1.75} />
                {pendingFile ? (
                  <span>{pendingFile.name} (queued)</span>
                ) : hasFile ? (
                  <span>Cert file on record.</span>
                ) : (
                  <span className="text-zinc-500">No cert file uploaded.</span>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={CFM_MIME.join(",")}
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  {hasFile || pendingFile ? "Replace" : "Upload"}
                </Button>
                {hasFile && !pendingFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleViewFile}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                    View
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              PDF / JPG / PNG up to 10 MB. Stored privately — only you and admins can view.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {savedAt !== null && (
              <Badge tone="success" className="inline-flex items-center gap-1">
                <Check className="h-3 w-3" strokeWidth={2.5} />
                Updated
              </Badge>
            )}
            <Button type="submit" disabled={uploading}>
              {uploading ? "Saving…" : "Save certificate"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
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
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: current,
      });
      if (signInErr) throw new Error("Current password is incorrect.");

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
