import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { normalizePhone } from "@/lib/phone";
import {
  addUser,
  fetchManageableRoles,
  fetchScopeOptions,
  type AddUserInput,
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
      return "global";
  }
}

export function AddUserModal({
  open,
  onClose,
}: {
  open: boolean;
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
  const [role, setRole] = useState<UserRole | "">("");
  const [scopeId, setScopeId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Reset form when reopened
  useEffect(() => {
    if (open) {
      setFullName("");
      setEmail("");
      setPhone("");
      setRole("");
      setScopeId("");
      setError(null);
    }
  }, [open]);

  // When role changes, reset the scope picker
  useEffect(() => {
    setScopeId("");
  }, [role]);

  const allowedRoles = rolesQuery.data?.roles ?? [];
  const scopeKind: ScopeKind | null = role ? scopeKindForRole(role) : null;

  const scopeOptions = useMemo(() => {
    if (!scopeKind || !scopeQuery.data) return [];
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

  const create = useMutation({
    mutationFn: (input: AddUserInput) => addUser(input),
    onSuccess: () => {
      toast.push("Invite sent. They'll get an email to set up their account.", "success");
      qc.invalidateQueries({ queryKey: ["my-team"] });
      onClose();
    },
    onError: (e: unknown) => {
      setError((e as Error)?.message ?? "Add user failed.");
    },
  });

  function submit() {
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("A valid email is required.");
      return;
    }
    if (!role) {
      setError("Choose a role.");
      return;
    }

    const kind = scopeKindForRole(role);
    if (kind !== "global" && !scopeId) {
      const label =
        kind === "store"
          ? "store"
          : kind === "district"
            ? "district"
            : kind === "area"
              ? "area"
              : "region";
      setError(`Pick a ${label} for this user.`);
      return;
    }

    let normalizedPhone: string | null = null;
    if (phone.trim()) {
      normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) {
        setError("Phone must be a 10-digit number (US).");
        return;
      }
    }

    create.mutate({
      full_name: fullName.trim() || undefined,
      email: trimmedEmail,
      phone: normalizedPhone ?? undefined,
      role,
      scope_type: kind,
      scope_id: kind === "global" ? null : scopeId,
    });
  }

  const loading = rolesQuery.isLoading || scopeQuery.isLoading;
  const loadError =
    rolesQuery.error || scopeQuery.error
      ? (rolesQuery.error as Error)?.message ?? (scopeQuery.error as Error)?.message
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add user"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={create.isPending || loading || !!loadError}
          >
            {create.isPending ? "Sending invite…" : "Send invite"}
          </Button>
        </>
      }
    >
      {loading && (
        <div className="py-6 text-center text-sm text-zinc-500">Loading…</div>
      )}

      {loadError && !loading && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {!loading && !loadError && (
        <div className="space-y-4">
          <div>
            <Label htmlFor="add-name">Full name</Label>
            <Input
              id="add-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
            />
          </div>

          <div>
            <Label htmlFor="add-email">Email *</Label>
            <Input
              id="add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              required
            />
            <p className="mt-1 text-xs text-zinc-500">
              An invite link will be emailed here.
            </p>
          </div>

          <div>
            <Label htmlFor="add-phone">Phone (optional)</Label>
            <Input
              id="add-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-1234"
            />
            <p className="mt-1 text-xs text-zinc-500">
              If provided, they can sign in with phone OR email.
            </p>
          </div>

          <div>
            <Label htmlFor="add-role">Role *</Label>
            <select
              id="add-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">— Select a role —</option>
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </select>
          </div>

          {role && scopeKind === "global" && (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              This role has org-wide visibility. Scope is set to{" "}
              <span className="font-medium">All stores</span>.
            </div>
          )}

          {role && scopeKind && scopeKind !== "global" && (
            <div>
              <Label htmlFor="add-scope">
                {scopeKind === "store" && "Store *"}
                {scopeKind === "district" && "District *"}
                {scopeKind === "area" && "Area *"}
                {scopeKind === "region" && "Region *"}
              </Label>
              <select
                id="add-scope"
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
              {scopeOptions.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  No {scopeKind}s found in your scope. Ask an admin to set up
                  org structure first.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
