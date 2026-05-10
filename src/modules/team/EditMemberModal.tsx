import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { formatPhoneForDisplay, normalizePhone } from "@/lib/phone";
import {
  fetchHistory,
  fetchManageableRoles,
  fetchScopeOptions,
  sendPasswordReset,
  updateUser,
  type AuditEntry,
  type ManagedUser,
  type UpdateUserInput,
} from "./api";

type ScopeKind = "store" | "district" | "area" | "region" | "global";

function scopeKindForRole(role: UserRole): ScopeKind {
  switch (role) {
    case "shift_manager":
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
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("shift_manager");
  const [scopeId, setScopeId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [gmAssignedDate, setGmAssignedDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Hydrate the form whenever the modal opens for a (different) member.
  useEffect(() => {
    if (open && member) {
      setFullName(member.full_name ?? "");
      setPhone(member.phone ? formatPhoneForDisplay(member.phone) : "");
      setRole(member.role);
      // Take the first scope as the source of truth (single-scope model)
      setScopeId(member.scopes[0]?.scope_id ?? "");
      setStartDate(member.start_date ?? "");
      setGmAssignedDate(member.gm_assigned_date ?? "");
      setError(null);
    }
  }, [open, member]);

  // When role changes from the original, reset scope so it must be re-picked.
  const originalRole = member?.role ?? null;
  useEffect(() => {
    if (originalRole && role !== originalRole) {
      setScopeId("");
    } else if (originalRole && role === originalRole) {
      // Restore original scope when reverted
      setScopeId(member?.scopes[0]?.scope_id ?? "");
    }
  }, [role, originalRole, member]);

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
    onSuccess: () => {
      toast.push("Saved.", "success");
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

  if (!member) return null;

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

    update.mutate({
      user_id: member.id,
      full_name: fullName.trim(),
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

  const loading = rolesQuery.isLoading || scopeQuery.isLoading;
  const isAdmin = managerRole === "admin";
  const anyMutationPending =
    update.isPending ||
    deactivate.isPending ||
    reactivate.isPending ||
    reset.isPending;

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
          {/* Read-only header info */}
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <div>
              <span className="text-zinc-500">Email:</span> {member.email}
            </div>
            {!member.is_active && (
              <div className="mt-1 text-amber-700 font-medium">
                This user is currently inactive.
              </div>
            )}
          </div>

          {/* Editable fields (only when active) */}
          {member.is_active && (
            <>
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

          <ActivitySection memberId={member.id} />
        </div>
      )}
    </Modal>
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
  }
}

function DiffSummary({ entry }: { entry: AuditEntry }) {
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
