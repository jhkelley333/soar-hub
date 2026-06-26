import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { formatPhoneForDisplay, normalizePhone } from "@/lib/phone";
import {
  addScope,
  fetchHistory,
  fetchManageableRoles,
  fetchScopeOptions,
  permDeleteUser,
  removeScope,
  sendPasswordReset,
  updateUser,
  type AdditionalScope,
  type AuditEntry,
  type ManagedUser,
  type ScopeOptionsResponse,
  type TeamListResponse,
  type UpdateUserInput,
} from "./api";

type ScopeKind = "store" | "district" | "area" | "region" | "global";

function scopeKindForRole(role: UserRole): ScopeKind {
  switch (role) {
    case "shift_manager":
    case "first_assistant_manager":
    case "associate_manager":
    case "crew_leader":
    case "crew_member":
    case "carhop":
    case "gm":
      return "store";
    case "do":
      return "district";
    case "sdo":
      return "area";
    case "rvp":
      return "region";
    case "vp":
    case "coo":
    case "admin":
    case "payroll":
    case "accounting":
    case "facilities":
    case "human_resources":
      return "global";
  }
}

export function EditMemberModal({
  open,
  member,
  managerRole,
  onClose,
}: {
  open: boolean;
  member: ManagedUser | null;
  managerRole: UserRole;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const rolesQuery = useQuery({
    queryKey: ["team", "manageable-roles"],
    queryFn: fetchManageableRoles,
    enabled: open,
  });

  const scopeQuery = useQuery({
    queryKey: ["team", "scope-options"],
    queryFn: fetchScopeOptions,
    enabled: open,
  });

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("shift_manager");
  const [scopeId, setScopeId] = useState<string>("");
  // Pinned snapshot of the scope the member had when the modal opened.
  // Used by the role-change effect to restore the original choice on
  // revert. We snapshot here so that subsequent re-renders that mint
  // a new `member` reference can't clobber the user's mid-edit
  // selection (the previous code depended on `member` directly and
  // re-fired the reset on every parent re-render).
  const [originalScopeId, setOriginalScopeId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [gmAssignedDate, setGmAssignedDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Hydrate the form whenever the modal opens for a (different) member. Guard
  // on the member ID so a live-data refetch (e.g. after adding coverage, which
  // hands us a new object with the same id) refreshes the coverage list
  // WITHOUT clobbering unsaved edits in the main form.
  const hydratedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedIdRef.current = null;
      return;
    }
    if (member && hydratedIdRef.current !== member.id) {
      hydratedIdRef.current = member.id;
      setFullName(member.full_name ?? "");
      setEmail(member.email ?? "");
      setPhone(member.phone ? formatPhoneForDisplay(member.phone) : "");
      setRole(member.role);
      // Take the first scope as the source of truth (single-scope model)
      const orig = member.scopes[0]?.scope_id ?? "";
      setScopeId(orig);
      setOriginalScopeId(orig);
      setStartDate(member.start_date ?? "");
      setGmAssignedDate(member.gm_assigned_date ?? "");
      setError(null);
    }
  }, [open, member]);

  // When role changes from the original, reset scope so it must be
  // re-picked. When role reverts to the original, restore the
  // originally-selected scope. Depends only on role + the captured
  // originals — NOT on `member`, so a parent re-render that produces
  // a new member reference can't blow away the user's edit.
  const originalRole = member?.role ?? null;
  useEffect(() => {
    if (!originalRole) return;
    if (role !== originalRole) {
      setScopeId("");
    } else {
      setScopeId(originalScopeId);
    }
  }, [role, originalRole, originalScopeId]);

  const allowedRoles = rolesQuery.data?.roles ?? [];
  // Make sure the target's CURRENT role is selectable too — managers can keep
  // a role unchanged even if it's outside their normal create-set
  // (e.g. an rvp editing another rvp's contact info would never happen, but
  // showing the current role as an option keeps the UI honest).
  const roleOptions = useMemo(() => {
    const set = new Set<UserRole>(allowedRoles);
    if (member?.role) set.add(member.role);
    return Array.from(set);
  }, [allowedRoles, member]);

  const scopeKind: ScopeKind = scopeKindForRole(role);

  const scopeOptions = useMemo(() => {
    if (!scopeQuery.data) return [];
    if (scopeKind === "store") {
      return scopeQuery.data.stores.map((s) => ({
        value: s.id,
        label: `Store ${s.number}${s.name ? " — " + s.name : ""}`,
      }));
    }
    if (scopeKind === "district") {
      return scopeQuery.data.districts.map((d) => ({
        value: d.id,
        label: `${d.name}${d.code ? ` (${d.code})` : ""}`,
      }));
    }
    if (scopeKind === "area") {
      return scopeQuery.data.areas.map((a) => ({
        value: a.id,
        label: `${a.name}${a.code ? ` (${a.code})` : ""}`,
      }));
    }
    if (scopeKind === "region") {
      return scopeQuery.data.regions.map((r) => ({
        value: r.id,
        label: `${r.name}${r.code ? ` (${r.code})` : ""}`,
      }));
    }
    return [];
  }, [scopeKind, scopeQuery.data]);

  const update = useMutation({
    mutationFn: (input: UpdateUserInput) => updateUser(input),
    onSuccess: (data) => {
      toast.push("Saved.", "success");
      if (data.email_reissued) {
        toast.push(`Invite re-sent to ${data.email_reissued}.`, "success");
      }
      qc.invalidateQueries({ queryKey: ["my-team"] });
    },
    onError: (e: unknown) => setError((e as Error)?.message ?? "Save failed."),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => updateUser({ user_id: id, is_active: false }),
    onSuccess: () => {
      toast.push("User deactivated.", "success");
      qc.invalidateQueries({ queryKey: ["my-team"] });
      onClose();
    },
    onError: (e: unknown) => setError((e as Error)?.message ?? "Deactivate failed."),
  });

  const reactivate = useMutation({
    mutationFn: (id: string) => updateUser({ user_id: id, is_active: true }),
    onSuccess: () => {
      toast.push("User reactivated.", "success");
      qc.invalidateQueries({ queryKey: ["my-team"] });
    },
    onError: (e: unknown) => setError((e as Error)?.message ?? "Reactivate failed."),
  });

  const reset = useMutation({
    mutationFn: (id: string) => sendPasswordReset(id),
    onSuccess: (data) => {
      toast.push(`Reset link sent to ${data.sent_to}.`, "success");
    },
    onError: (e: unknown) => setError((e as Error)?.message ?? "Send reset failed."),
  });

  const permDelete = useMutation({
    mutationFn: (id: string) => permDeleteUser(id),
    onSuccess: () => {
      toast.push("User permanently deleted.", "success");
      qc.invalidateQueries({ queryKey: ["my-team"] });
      onClose();
    },
    onError: (e: unknown) => setError((e as Error)?.message ?? "Delete failed."),
  });

  if (!member) return null;

  // DO and above may correct a mistyped email; GMs cannot.
  const canEditEmail = (["do", "sdo", "rvp", "vp", "coo", "admin"] as UserRole[]).includes(
    managerRole
  );

  // Admin / VP / COO grant additional ("acting") coverage to anyone; RVP / SDO
  // may also grant it, limited to their own team + reach (server-enforced, and
  // the scope picker only offers nodes within their reach).
  const canManageScope = (["admin", "vp", "coo", "rvp", "sdo"] as UserRole[]).includes(
    managerRole
  );

  function submitEdits() {
    if (!member) return;
    setError(null);

    if (scopeKind !== "global" && !scopeId) {
      const label =
        scopeKind === "store"
          ? "store"
          : scopeKind === "district"
            ? "district"
            : scopeKind === "area"
              ? "area"
              : "region";
      setError(`Pick a ${label}.`);
      return;
    }

    let normalizedPhone: string | null | undefined = undefined;
    if (phone.trim() === "") {
      normalizedPhone = null;
    } else {
      normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) {
        setError("Phone must be a 10-digit number.");
        return;
      }
    }

    // Email is sent only when a DO+ actually changed it.
    let emailField: string | undefined = undefined;
    if (canEditEmail) {
      const trimmedEmail = email.trim().toLowerCase();
      if (trimmedEmail !== (member.email ?? "").toLowerCase()) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
          setError("Enter a valid email address.");
          return;
        }
        emailField = trimmedEmail;
      }
    }

    update.mutate({
      user_id: member.id,
      full_name: fullName.trim(),
      ...(emailField ? { email: emailField } : {}),
      phone: normalizedPhone,
      role,
      scope_type: scopeKind,
      scope_id: scopeKind === "global" ? null : scopeId,
      start_date: startDate.trim() === "" ? null : startDate,
      gm_assigned_date: gmAssignedDate.trim() === "" ? null : gmAssignedDate,
    });
  }

  function onDeactivate() {
    if (!member) return;
    if (
      !window.confirm(
        `Deactivate ${member.full_name || member.email}? They won't be able to sign in. An admin can reactivate later.`
      )
    ) {
      return;
    }
    deactivate.mutate(member.id);
  }

  function onReactivate() {
    if (!member) return;
    reactivate.mutate(member.id);
  }

  function onPermDelete() {
    if (!member) return;
    const label = member.full_name || member.email;
    if (
      !window.confirm(
        `Permanently delete ${label}?\n\nThis erases their account and sign-in for good — it cannot be undone. (A record of the deletion is kept in history.) To keep their records, use Deactivate instead.`
      )
    ) {
      return;
    }
    permDelete.mutate(member.id);
  }

  const loading = rolesQuery.isLoading || scopeQuery.isLoading;
  const isAdmin = managerRole === "admin";
  const anyMutationPending =
    update.isPending ||
    deactivate.isPending ||
    reactivate.isPending ||
    reset.isPending ||
    permDelete.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${member.full_name || member.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submitEdits}
            disabled={anyMutationPending || loading || !member.is_active}
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="py-6 text-center text-sm text-zinc-500">Loading…</div>
      ) : (
        <div className="space-y-4">
          {/* Read-only header info. Email shows here unless a DO+ can edit
              it below (active members only). */}
          {(!(canEditEmail && member.is_active) || !member.is_active) && (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              {!(canEditEmail && member.is_active) && (
                <div>
                  <span className="text-zinc-500">Email:</span> {member.email}
                </div>
              )}
              {!member.is_active && (
                <div className="mt-1 text-amber-700 font-medium">
                  This user is currently inactive.
                </div>
              )}
            </div>
          )}

          {/* Editable fields (only when active) */}
          {member.is_active && (
            <>
              {canEditEmail && (
                <div>
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Fix a mistyped sign-in address. If they haven't activated
                    their account yet, a fresh invite is sent to the new email.
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="edit-name">Full name</Label>
                <Input
                  id="edit-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 555-1234 or empty to clear"
                />
              </div>

              <div>
                <Label htmlFor="edit-role">Role</Label>
                <select
                  id="edit-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r] ?? r}
                    </option>
                  ))}
                </select>
              </div>

              {scopeKind === "global" ? (
                <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                  This role has org-wide visibility. Scope:{" "}
                  <span className="font-medium">All stores</span>.
                </div>
              ) : (
                <div>
                  <Label htmlFor="edit-scope">
                    {scopeKind === "store" && "Store"}
                    {scopeKind === "district" && "District"}
                    {scopeKind === "area" && "Area"}
                    {scopeKind === "region" && "Region"}
                  </Label>
                  <select
                    id="edit-scope"
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="">— Select —</option>
                    {scopeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="edit-start-date">Start date</Label>
                  <Input
                    id="edit-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    When they joined SOAR. Empty to clear.
                  </p>
                </div>
                {role === "gm" && (
                  <div>
                    <Label htmlFor="edit-gm-assigned">GM assigned date</Label>
                    <Input
                      id="edit-gm-assigned"
                      type="date"
                      value={gmAssignedDate}
                      onChange={(e) => setGmAssignedDate(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-zinc-500">
                      When they took over their current store.
                    </p>
                  </div>
                )}
              </div>

              {canManageScope && (
                <AdditionalCoverageSection member={member} scopeData={scopeQuery.data} />
              )}
            </>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Send password reset — active users only */}
          {member.is_active && (
            <div className="border-t border-zinc-100 pt-4">
              <Button
                variant="secondary"
                onClick={() => member && reset.mutate(member.id)}
                disabled={anyMutationPending}
              >
                {reset.isPending ? "Sending…" : "Send password reset"}
              </Button>
              <p className="mt-1 text-xs text-zinc-500">
                Emails them a link to set a new password.
              </p>
            </div>
          )}

          {/* Activate / Deactivate footer block */}
          <div className="border-t border-zinc-100 pt-4">
            {member.is_active ? (
              <Button
                variant="danger"
                onClick={onDeactivate}
                disabled={anyMutationPending}
              >
                {deactivate.isPending ? "Deactivating…" : "Deactivate user"}
              </Button>
            ) : isAdmin ? (
              <Button onClick={onReactivate} disabled={anyMutationPending}>
                {reactivate.isPending ? "Reactivating…" : "Reactivate user"}
              </Button>
            ) : (
              <p className="text-xs text-zinc-500">
                Only an Admin can reactivate a user.
              </p>
            )}
          </div>

          {/* Permanent delete — admin only. Destructive + irreversible. */}
          {isAdmin && (
            <div className="border-t border-red-100 pt-4">
              <Button
                variant="danger"
                onClick={onPermDelete}
                disabled={anyMutationPending}
              >
                {permDelete.isPending ? "Deleting…" : "Permanently delete"}
              </Button>
              <p className="mt-1 text-xs text-zinc-500">
                Erases the account for good. Prefer Deactivate to keep their
                records — deletion is blocked for users with historical data.
              </p>
            </div>
          )}

          <ActivitySection memberId={member.id} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Additional coverage (acting scope) — admin / VP / COO only
// ---------------------------------------------------------------------------

function AdditionalCoverageSection({
  member,
  scopeData,
}: {
  member: ManagedUser;
  scopeData: ScopeOptionsResponse | undefined;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"district" | "area" | "region" | "store">("district");
  const [nodeId, setNodeId] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const nodeOptions = useMemo(() => {
    if (!scopeData) return [] as { value: string; label: string }[];
    if (kind === "store")
      return scopeData.stores.map((s) => ({
        value: s.id,
        label: `Store ${s.number}${s.name ? " — " + s.name : ""}`,
      }));
    if (kind === "district")
      return scopeData.districts.map((d) => ({
        value: d.id,
        label: `${d.name}${d.code ? ` (${d.code})` : ""}`,
      }));
    if (kind === "area")
      return scopeData.areas.map((a) => ({
        value: a.id,
        label: `${a.name}${a.code ? ` (${a.code})` : ""}`,
      }));
    return scopeData.regions.map((r) => ({
      value: r.id,
      label: `${r.name}${r.code ? ` (${r.code})` : ""}`,
    }));
  }, [kind, scopeData]);

  // Patch the cached team list's member.additional_scopes so the change shows
  // immediately (the invalidate that follows reconciles with the server's
  // labeled rows). Returns the previous cache for rollback on error.
  function patchCache(fn: (rows: AdditionalScope[]) => AdditionalScope[]) {
    const prev = qc.getQueryData<TeamListResponse>(["my-team"]);
    if (prev) {
      qc.setQueryData<TeamListResponse>(["my-team"], {
        ...prev,
        members: prev.members.map((m) =>
          m.id === member.id
            ? { ...m, additional_scopes: fn(m.additional_scopes ?? []) }
            : m
        ),
      });
    }
    return prev;
  }

  const add = useMutation({
    mutationFn: () =>
      addScope({
        user_id: member.id,
        scope_type: kind,
        scope_id: nodeId,
        expires_at: end.trim() === "" ? null : end,
      }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["my-team"] });
      const selected = nodeOptions.find((o) => o.value === nodeId);
      const optimistic: AdditionalScope = {
        id: `optimistic-${kind}-${nodeId}`,
        scope_type: kind,
        scope_id: nodeId,
        label: selected?.label ?? `${kind[0].toUpperCase()}${kind.slice(1)}`,
        expires_at: end.trim() === "" ? null : `${end}T23:59:59Z`,
        note: null,
      };
      const prev = patchCache((rows) => [...rows, optimistic]);
      return { prev };
    },
    onSuccess: () => {
      toast.push("Coverage added.", "success");
      setNodeId("");
      setEnd("");
      setErr(null);
    },
    onError: (e: unknown, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["my-team"], ctx.prev);
      setErr((e as Error)?.message ?? "Couldn't add coverage.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["my-team"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeScope(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["my-team"] });
      const prev = patchCache((rows) => rows.filter((s) => s.id !== id));
      return { prev };
    },
    onSuccess: () => toast.push("Coverage removed.", "success"),
    onError: (e: unknown, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["my-team"], ctx.prev);
      setErr((e as Error)?.message ?? "Couldn't remove coverage.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["my-team"] }),
  });

  const existing = member.additional_scopes ?? [];
  const today = new Date().toISOString().slice(0, 10);

  function expiryLabel(iso: string | null): { text: string; expired: boolean } | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const expired = d.getTime() < Date.now();
    const when = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return { text: `${expired ? "expired" : "until"} ${when}`, expired };
  }

  return (
    <div className="border-t border-zinc-100 pt-4">
      <Label>Additional coverage</Label>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        Extra districts/areas/regions/stores this person covers on top of their role —
        e.g. an RVP acting as DO for a district. Adds to what they can see and manage.
      </p>

      {existing.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {existing.map((s) => {
            const exp = expiryLabel(s.expires_at);
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
              >
                <span className={exp?.expired ? "text-zinc-400 line-through" : "text-zinc-800"}>
                  {s.label}
                  {exp && (
                    <span className={`ml-2 text-[11px] ${exp.expired ? "text-red-500" : "text-zinc-500"}`}>
                      ({exp.text})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => remove.mutate(s.id)}
                  disabled={remove.isPending}
                  className="shrink-0 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="cov-kind">Level</Label>
          <select
            id="cov-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setNodeId("");
            }}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="district">District</option>
            <option value="area">Area</option>
            <option value="region">Region</option>
            <option value="store">Store</option>
          </select>
        </div>
        <div>
          <Label htmlFor="cov-node">{kind[0].toUpperCase() + kind.slice(1)}</Label>
          <select
            id="cov-node"
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">— Select —</option>
            {nodeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="cov-end">End date (optional)</Label>
          <Input
            id="cov-end"
            type="date"
            min={today}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-zinc-500">
            Blank = permanent. Set for temporary acting coverage.
          </p>
        </div>
        <div className="flex items-end">
          <Button
            variant="secondary"
            onClick={() => {
              if (!nodeId) {
                setErr("Pick a place to cover.");
                return;
              }
              add.mutate();
            }}
            disabled={add.isPending}
          >
            {add.isPending ? "Adding…" : "Add coverage"}
          </Button>
        </div>
      </div>

      {err && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity (audit history)
// ---------------------------------------------------------------------------

function ActivitySection({ memberId }: { memberId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["team", "history", memberId],
    queryFn: () => fetchHistory(memberId, 20),
    enabled: open,
  });

  return (
    <div className="border-t border-zinc-100 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium uppercase tracking-wider text-zinc-500 transition hover:text-midnight"
      >
        {open ? "▾" : "▸"} Activity
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {query.isLoading && (
            <div className="text-xs text-zinc-500">Loading…</div>
          )}
          {query.isError && (
            <div className="text-xs text-red-600">
              {(query.error as Error)?.message ?? "Couldn't load history."}
            </div>
          )}
          {query.data && query.data.entries.length === 0 && (
            <div className="text-xs text-zinc-500">No activity yet.</div>
          )}
          {query.data &&
            query.data.entries.map((e) => (
              <ActivityRow key={e.id} entry={e} />
            ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: AuditEntry }) {
  const when = new Date(entry.created_at);
  const whenStr = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const actor =
    entry.actor.full_name?.trim() || entry.actor.email || "Someone";

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-midnight">
          {actionLabel(entry.action)}
        </span>
        <span className="text-zinc-500">{whenStr}</span>
      </div>
      <div className="mt-0.5 text-zinc-600">by {actor}</div>
      <DiffSummary entry={entry} />
    </div>
  );
}

function actionLabel(action: AuditEntry["action"]): string {
  switch (action) {
    case "create":
      return "Created";
    case "update":
      return "Updated";
    case "deactivate":
      return "Deactivated";
    case "reactivate":
      return "Reactivated";
    case "delete":
      return "Permanently deleted";
    case "add_scope":
      return "Added coverage";
    case "remove_scope":
      return "Removed coverage";
  }
}

function DiffSummary({ entry }: { entry: AuditEntry }) {
  if (entry.action === "delete" && entry.before) {
    const b = entry.before as Record<string, unknown>;
    const bits: string[] = [];
    if (b.email) bits.push(String(b.email));
    if (b.role) bits.push(`role: ${b.role}`);
    if (!bits.length) return null;
    return <div className="mt-1 text-zinc-500">{bits.join(" · ")}</div>;
  }
  if (entry.action === "create" && entry.after) {
    const a = entry.after as Record<string, unknown>;
    const bits: string[] = [];
    if (a.role) bits.push(`role: ${a.role}`);
    if (a.scope_type) bits.push(`scope: ${a.scope_type}`);
    if (!bits.length) return null;
    return <div className="mt-1 text-zinc-500">{bits.join(" · ")}</div>;
  }
  if (entry.action === "update" && entry.before && entry.after) {
    const before = entry.before as Record<string, unknown>;
    const after = entry.after as Record<string, unknown>;
    const lines: string[] = [];
    for (const key of Object.keys(after)) {
      if (key === "scope") {
        // scope is { scope_type, scope_id } before/after
        const b = before[key] as { scope_type?: string } | null;
        const aft = after[key] as { scope_type?: string } | null;
        const bs = b ? b.scope_type ?? "—" : "—";
        const as_ = aft ? aft.scope_type ?? "—" : "—";
        lines.push(`scope: ${bs} → ${as_}`);
        continue;
      }
      const bv = before[key];
      const av = after[key];
      lines.push(`${key}: ${formatVal(bv)} → ${formatVal(av)}`);
    }
    if (!lines.length) return null;
    return (
      <div className="mt-1 space-y-0.5 text-zinc-500">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    );
  }
  return null;
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}
