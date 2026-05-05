import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { normalizePhone, formatPhoneForDisplay } from "@/lib/phone";
import {
  createOrgNode,
  moveOrgNode,
  updateOrgNode,
  type CreateOrgNodeInput,
  type OrgArea,
  type OrgDistrict,
  type OrgRegion,
  type OrgStore,
  type OrgTargetKind,
  type OrgTreeResponse,
  type UpdateOrgNodeInput,
} from "./api";

type AnyOrgNode = OrgRegion | OrgArea | OrgDistrict | OrgStore;

type EditTarget =
  | { kind: "region"; node: OrgRegion }
  | { kind: "area"; node: OrgArea; region_id: string }
  | { kind: "district"; node: OrgDistrict; area_id: string }
  | { kind: "store"; node: OrgStore; district_id: string };

type AddTarget =
  | { kind: "region" }
  | { kind: "area"; region_id: string }
  | { kind: "district"; area_id: string }
  | { kind: "store"; district_id: string };

const KIND_LABEL: Record<OrgTargetKind, string> = {
  region: "Region",
  area: "Area",
  district: "District",
  store: "Store",
};

// ----------------------------------------------------------------------------
// EditOrgNodeModal — rename / edit fields / move parent / deactivate
// ----------------------------------------------------------------------------

export function EditOrgNodeModal({
  open,
  target,
  tree,
  onClose,
}: {
  open: boolean;
  target: EditTarget | null;
  tree: OrgTreeResponse | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Hydrate fields from the target whenever the modal opens for a (new) node.
  useEffect(() => {
    if (!open || !target) return;
    setError(null);
    if (target.kind === "store") {
      setCode("");
      setName(target.node.name ?? "");
      setNumber(target.node.number ?? "");
      setPhone(target.node.phone ? formatPhoneForDisplay(target.node.phone) : "");
      setAddress(target.node.address ?? "");
      setCity(target.node.city ?? "");
      setState(target.node.state ?? "");
      setZip(target.node.zip ?? "");
      setParentId(target.district_id);
    } else {
      setNumber("");
      setPhone("");
      setAddress("");
      setCity("");
      setState("");
      setZip("");
      setCode(target.node.code ?? "");
      setName(target.node.name ?? "");
      setParentId(
        target.kind === "area"
          ? target.region_id
          : target.kind === "district"
            ? target.area_id
            : ""
      );
    }
  }, [open, target]);

  const update = useMutation({
    mutationFn: (input: UpdateOrgNodeInput) => updateOrgNode(input),
  });
  const move = useMutation({ mutationFn: moveOrgNode });

  if (!target) return null;

  // Original parent id for "moved?" detection.
  const originalParent =
    target.kind === "area"
      ? target.region_id
      : target.kind === "district"
        ? target.area_id
        : target.kind === "store"
          ? target.district_id
          : "";

  // Build parent options (only relevant for non-region kinds).
  const parentOptions = (() => {
    if (!tree) return [];
    if (target.kind === "area") {
      return tree.regions.map((r) => ({
        value: r.id,
        label: `${r.code} — ${r.name}`,
      }));
    }
    if (target.kind === "district") {
      return tree.regions.flatMap((r) =>
        r.areas.map((a) => ({
          value: a.id,
          label: `${a.code} — ${a.name} (${r.code})`,
        }))
      );
    }
    if (target.kind === "store") {
      return tree.regions.flatMap((r) =>
        r.areas.flatMap((a) =>
          a.districts.map((d) => ({
            value: d.id,
            label: `${d.code} — ${d.name} (${a.name})`,
          }))
        )
      );
    }
    return [];
  })();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);

    // Build the field updates. We only send keys the user could actually
    // change for this kind.
    const updates: UpdateOrgNodeInput = { kind: target.kind, id: target.node.id };
    if (target.kind === "store") {
      updates.number = number.trim();
      updates.name = name.trim();
      let normalizedPhone: string | null = null;
      if (phone.trim() !== "") {
        normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
          setError("Phone must be a 10-digit number.");
          return;
        }
      }
      updates.phone = normalizedPhone;
      updates.address = address.trim() || null;
      updates.city = city.trim() || null;
      updates.state = state.trim() || null;
      updates.zip = zip.trim() || null;
    } else {
      updates.code = code.trim();
      updates.name = name.trim();
    }

    try {
      await update.mutateAsync(updates);
      // Move if parent changed (skip for regions — no parent).
      if (target.kind !== "region" && parentId && parentId !== originalParent) {
        await move.mutateAsync({
          kind: target.kind,
          id: target.node.id,
          ...(target.kind === "area" ? { region_id: parentId } : {}),
          ...(target.kind === "district" ? { area_id: parentId } : {}),
          ...(target.kind === "store" ? { district_id: parentId } : {}),
        } as never);
      }
      qc.invalidateQueries({ queryKey: ["org-tree"] });
      toast.push("Saved.", "success");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function toggleActive() {
    if (!target) return;
    const next = !target.node.is_active;
    if (
      next === false &&
      !window.confirm(
        `Deactivate ${KIND_LABEL[target.kind]} "${(target.node as AnyOrgNode).name ?? ""}"? It can be reactivated later.`
      )
    ) {
      return;
    }
    try {
      await update.mutateAsync({
        kind: target.kind,
        id: target.node.id,
        is_active: next,
      });
      qc.invalidateQueries({ queryKey: ["org-tree"] });
      toast.push(next ? "Reactivated." : "Deactivated.", "success");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    }
  }

  const submitting = update.isPending || move.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${KIND_LABEL[target.kind]}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !isAdmin}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      {!isAdmin && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Read-only — only Admins can edit the org tree.
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {target.kind === "store" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="org-store-number">Store number</Label>
                <Input
                  id="org-store-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-store-phone">Phone</Label>
                <Input
                  id="org-store-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="org-store-name">Store name</Label>
              <Input
                id="org-store-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label htmlFor="org-store-address">Address</Label>
              <Input
                id="org-store-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="org-store-city">City</Label>
                <Input
                  id="org-store-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-store-state">State</Label>
                <Input
                  id="org-store-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-store-zip">ZIP</Label>
                <Input
                  id="org-store-zip"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="org-code">Code</Label>
                <Input
                  id="org-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>
          </>
        )}

        {target.kind !== "region" && parentOptions.length > 0 && (
          <div>
            <Label htmlFor="org-parent">
              {target.kind === "area" && "Parent region"}
              {target.kind === "district" && "Parent area"}
              {target.kind === "store" && "Parent district"}
            </Label>
            <select
              id="org-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={!isAdmin}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
            >
              {parentOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {parentId !== originalParent && (
              <p className="mt-1 text-xs text-amber-700">
                Saving will move this {KIND_LABEL[target.kind].toLowerCase()} to the new parent.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Deactivate / reactivate footer */}
        <div className="border-t border-zinc-100 pt-4">
          <Button
            type="button"
            variant={target.node.is_active ? "danger" : "primary"}
            onClick={toggleActive}
            disabled={submitting || !isAdmin}
          >
            {target.node.is_active
              ? `Deactivate ${KIND_LABEL[target.kind]}`
              : `Reactivate ${KIND_LABEL[target.kind]}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// AddOrgNodeModal — create a new region/area/district/store under a parent
// ----------------------------------------------------------------------------

export function AddOrgNodeModal({
  open,
  target,
  parentLabel,
  onClose,
}: {
  open: boolean;
  target: AddTarget | null;
  parentLabel?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode("");
    setName("");
    setNumber("");
    setPhone("");
    setAddress("");
    setCity("");
    setState("");
    setZip("");
    setError(null);
  }, [open, target]);

  const create = useMutation({ mutationFn: createOrgNode });

  if (!target) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);

    let input: CreateOrgNodeInput;
    if (target.kind === "store") {
      let normalizedPhone: string | null = null;
      if (phone.trim() !== "") {
        normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
          setError("Phone must be a 10-digit number.");
          return;
        }
      }
      input = {
        kind: "store",
        number: number.trim(),
        name: name.trim(),
        district_id: target.district_id,
        phone: normalizedPhone,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zip: zip.trim() || null,
      };
    } else if (target.kind === "region") {
      input = { kind: "region", code: code.trim(), name: name.trim() };
    } else if (target.kind === "area") {
      input = {
        kind: "area",
        code: code.trim(),
        name: name.trim(),
        region_id: target.region_id,
      };
    } else {
      input = {
        kind: "district",
        code: code.trim(),
        name: name.trim(),
        area_id: target.area_id,
      };
    }

    try {
      await create.mutateAsync(input);
      qc.invalidateQueries({ queryKey: ["org-tree"] });
      toast.push(`${KIND_LABEL[target.kind]} created.`, "success");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${KIND_LABEL[target.kind]}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending || !isAdmin}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      {!isAdmin && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Only Admins can add to the org tree.
        </div>
      )}

      {parentLabel && (
        <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          Under: <span className="font-medium text-midnight">{parentLabel}</span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {target.kind === "store" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="add-store-number">Store number *</Label>
                <Input
                  id="add-store-number"
                  required
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="add-store-phone">Phone</Label>
                <Input
                  id="add-store-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="add-store-name">Store name *</Label>
              <Input
                id="add-store-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <Label htmlFor="add-store-address">Address</Label>
              <Input
                id="add-store-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="add-store-city">City</Label>
                <Input
                  id="add-store-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="add-store-state">State</Label>
                <Input
                  id="add-store-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="add-store-zip">ZIP</Label>
                <Input
                  id="add-store-zip"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="add-code">Code *</Label>
              <Input
                id="add-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!isAdmin}
                placeholder={
                  target.kind === "region"
                    ? "e.g. R5"
                    : target.kind === "area"
                      ? "e.g. Area 10"
                      : "e.g. D113"
                }
              />
            </div>
            <div>
              <Label htmlFor="add-name">Name *</Label>
              <Input
                id="add-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}

export type { EditTarget, AddTarget };
