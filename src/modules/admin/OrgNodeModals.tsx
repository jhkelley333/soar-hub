import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
  type DriveThruType,
  type OrgArea,
  type OrgDistrict,
  type OrgRegion,
  type OrgStore,
  type OrgTargetKind,
  type OrgTreeResponse,
  type UpdateOrgNodeInput,
} from "./api";

// Hardcoded for Phase 1. Phase 2 will move this to an admin-managed
// config table so new providers can be added without a code change.
const THIRD_PARTY_PROVIDERS: { key: string; label: string }[] = [
  { key: "doordash", label: "DoorDash" },
  { key: "ubereats", label: "Uber Eats" },
  { key: "grubhub", label: "Grubhub" },
  { key: "ezcater", label: "EzCater" },
  { key: "postmates", label: "Postmates" },
];

const DRIVE_THRU_TYPES: { key: DriveThruType; label: string }[] = [
  { key: "single_pole_two_menus", label: "Single pole, two menus" },
  { key: "split_housing", label: "Split housing" },
];

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
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [parentId, setParentId] = useState("");
  // Operations / vendor (admin-only)
  const [plateIqEmail, setPlateIqEmail] = useState("");
  const [soarCompanyName, setSoarCompanyName] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [posSystem, setPosSystem] = useState("");
  const [securityVendor, setSecurityVendor] = useState("");
  const [foodVendorName, setFoodVendorName] = useState("");
  // Active programs
  const [hasApplePay, setHasApplePay] = useState(false);
  const [hasOrderAhead, setHasOrderAhead] = useState(false);
  const [hasOutdoorSeating, setHasOutdoorSeating] = useState(false);
  const [hasDriveThru, setHasDriveThru] = useState(false);
  const [hasClearanceBar, setHasClearanceBar] = useState(false);
  const [driveThruLanes, setDriveThruLanes] = useState<string>(""); // "" | "1" | "2"
  const [driveThruType, setDriveThruType] = useState<string>("");
  const [publicRestroomCount, setPublicRestroomCount] = useState<string>("0");
  // Stall data
  const [patioPopMenuCount, setPatioPopMenuCount] = useState<string>("0");
  const [patioPopStallNumbers, setPatioPopStallNumbers] = useState("");
  const [orderAheadStallCount, setOrderAheadStallCount] = useState<string>("0");
  const [orderAheadStallNumbers, setOrderAheadStallNumbers] = useState("");
  const [stallPopMenuCount, setStallPopMenuCount] = useState<string>("0");
  const [hasTrailerStall, setHasTrailerStall] = useState(false);
  const [trailerStallNumber, setTrailerStallNumber] = useState("");
  // Third-party delivery
  const [thirdPartyDelivery, setThirdPartyDelivery] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Hydrate fields from the target whenever the modal opens for a (new) node.
  useEffect(() => {
    if (!open || !target) return;
    setError(null);
    if (target.kind === "store") {
      const s = target.node;
      setCode("");
      setName(s.name ?? "");
      setNumber(s.number ?? "");
      setPhone(s.phone ? formatPhoneForDisplay(s.phone) : "");
      setEmail(s.email ?? "");
      setAddress(s.address ?? "");
      setCity(s.city ?? "");
      setState(s.state ?? "");
      setZip(s.zip ?? "");
      setParentId(target.district_id);
      setPlateIqEmail(s.plate_iq_email ?? "");
      setSoarCompanyName(s.soar_company_name ?? "");
      setAcquisitionDate(s.acquisition_date ?? "");
      setPosSystem(s.pos_system ?? "");
      setSecurityVendor(s.security_vendor ?? "");
      setFoodVendorName(s.food_vendor_name ?? "");
      setHasApplePay(!!s.has_apple_pay);
      setHasOrderAhead(!!s.has_order_ahead);
      setHasOutdoorSeating(!!s.has_outdoor_seating);
      setHasDriveThru(!!s.has_drive_thru);
      setHasClearanceBar(!!s.has_clearance_bar);
      setDriveThruLanes(s.drive_thru_lanes != null ? String(s.drive_thru_lanes) : "");
      setDriveThruType(s.drive_thru_type ?? "");
      setPublicRestroomCount(String(s.public_restroom_count ?? 0));
      setPatioPopMenuCount(String(s.patio_pop_menu_count ?? 0));
      setPatioPopStallNumbers(s.patio_pop_stall_numbers ?? "");
      setOrderAheadStallCount(String(s.order_ahead_stall_count ?? 0));
      setOrderAheadStallNumbers(s.order_ahead_stall_numbers ?? "");
      setStallPopMenuCount(String(s.stall_pop_menu_count ?? 0));
      setHasTrailerStall(!!s.has_trailer_stall);
      setTrailerStallNumber(s.trailer_stall_number ?? "");
      setThirdPartyDelivery(Array.isArray(s.third_party_delivery) ? s.third_party_delivery : []);
    } else {
      setNumber("");
      setPhone("");
      setEmail("");
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
      updates.email = email.trim() || null;
      updates.address = address.trim() || null;
      updates.city = city.trim() || null;
      updates.state = state.trim() || null;
      updates.zip = zip.trim() || null;
      updates.plate_iq_email = plateIqEmail.trim() || null;
      updates.soar_company_name = soarCompanyName.trim() || null;
      // Acquisition date — HTML date input already emits YYYY-MM-DD.
      // Empty string clears the column; the backend's "date" validator
      // accepts null but not "" so coalesce here.
      updates.acquisition_date = acquisitionDate.trim() || null;
      updates.pos_system = posSystem.trim() || null;
      updates.security_vendor = securityVendor.trim() || null;
      updates.food_vendor_name = foodVendorName.trim() || null;
      updates.has_apple_pay = hasApplePay;
      updates.has_order_ahead = hasOrderAhead;
      updates.has_outdoor_seating = hasOutdoorSeating;
      updates.has_drive_thru = hasDriveThru;
      updates.has_clearance_bar = hasClearanceBar;
      updates.drive_thru_lanes = driveThruLanes ? parseInt(driveThruLanes, 10) : null;
      updates.drive_thru_type = (driveThruType || null) as DriveThruType | null;
      updates.public_restroom_count = parseInt(publicRestroomCount || "0", 10) || 0;
      updates.patio_pop_menu_count = parseInt(patioPopMenuCount || "0", 10) || 0;
      updates.patio_pop_stall_numbers = patioPopStallNumbers.trim() || null;
      updates.order_ahead_stall_count = parseInt(orderAheadStallCount || "0", 10) || 0;
      updates.order_ahead_stall_numbers = orderAheadStallNumbers.trim() || null;
      updates.stall_pop_menu_count = parseInt(stallPopMenuCount || "0", 10) || 0;
      updates.has_trailer_stall = hasTrailerStall;
      updates.trailer_stall_number = trailerStallNumber.trim() || null;
      updates.third_party_delivery = thirdPartyDelivery;
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
      // Await the refetch so the modal doesn't close (and the toast
      // doesn't fire) until the tree shows the new value. Otherwise the
      // page can briefly render stale data and users believe the save
      // didn't take.
      await qc.refetchQueries({ queryKey: ["org-tree"] });
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
      await qc.refetchQueries({ queryKey: ["org-tree"] });
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
      maxWidth={target.kind === "store" ? "max-w-3xl" : "max-w-lg"}
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
            <div className="grid grid-cols-2 gap-3">
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
                <Label htmlFor="org-store-email">Store email</Label>
                <Input
                  id="org-store-email"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!isAdmin}
                  autoCapitalize="off"
                />
              </div>
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

            {/* Operations & vendor (admin-only) */}
            <SectionHeader>Operations &amp; vendor</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="org-plate-iq">Plate IQ Email</Label>
                <Input
                  id="org-plate-iq"
                  type="email"
                  inputMode="email"
                  autoCapitalize="off"
                  value={plateIqEmail}
                  onChange={(e) => setPlateIqEmail(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-soar-co">Soar Company Name</Label>
                <Input
                  id="org-soar-co"
                  value={soarCompanyName}
                  onChange={(e) => setSoarCompanyName(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-acq-date">Acquisition Date</Label>
                <Input
                  id="org-acq-date"
                  type="date"
                  value={acquisitionDate}
                  onChange={(e) => setAcquisitionDate(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-pos">POS</Label>
                <Input
                  id="org-pos"
                  value={posSystem}
                  onChange={(e) => setPosSystem(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-food-vendor">Food Vendor</Label>
                <Input
                  id="org-food-vendor"
                  value={foodVendorName}
                  onChange={(e) => setFoodVendorName(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-security-vendor">Security Vendor</Label>
                <Input
                  id="org-security-vendor"
                  value={securityVendor}
                  onChange={(e) => setSecurityVendor(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>

            {/* Active programs */}
            <SectionHeader>Active programs</SectionHeader>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Toggle
                label="Apple Pay"
                checked={hasApplePay}
                onChange={setHasApplePay}
                disabled={!isAdmin}
              />
              <Toggle
                label="Order Ahead"
                checked={hasOrderAhead}
                onChange={setHasOrderAhead}
                disabled={!isAdmin}
              />
              <Toggle
                label="Outdoor seating"
                checked={hasOutdoorSeating}
                onChange={setHasOutdoorSeating}
                disabled={!isAdmin}
              />
              <Toggle
                label="Drive-thru"
                checked={hasDriveThru}
                onChange={setHasDriveThru}
                disabled={!isAdmin}
              />
            </div>

            {hasDriveThru && (
              <div className="grid grid-cols-3 gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                <div>
                  <Label htmlFor="org-dt-lanes">Drive-thru lanes</Label>
                  <select
                    id="org-dt-lanes"
                    value={driveThruLanes}
                    onChange={(e) => setDriveThruLanes(e.target.value)}
                    disabled={!isAdmin}
                    className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                  >
                    <option value="">—</option>
                    <option value="1">Single (1 lane)</option>
                    <option value="2">Double (2 lanes)</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="org-dt-type">Drive-thru type</Label>
                  <select
                    id="org-dt-type"
                    value={driveThruType}
                    onChange={(e) => setDriveThruType(e.target.value)}
                    disabled={!isAdmin}
                    className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                  >
                    <option value="">—</option>
                    {DRIVE_THRU_TYPES.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <Toggle
                    label="Clearance bar"
                    checked={hasClearanceBar}
                    onChange={setHasClearanceBar}
                    disabled={!isAdmin}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="org-restrooms">Public restrooms</Label>
                <Input
                  id="org-restrooms"
                  type="number"
                  min={0}
                  max={99}
                  value={publicRestroomCount}
                  onChange={(e) => setPublicRestroomCount(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>

            {/* Stall data */}
            <SectionHeader>Stall data</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="org-patio-pop-count"># Patio POP menus</Label>
                <Input
                  id="org-patio-pop-count"
                  type="number"
                  min={0}
                  value={patioPopMenuCount}
                  onChange={(e) => setPatioPopMenuCount(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-patio-pop-stalls">Patio POP stall #s</Label>
                <Input
                  id="org-patio-pop-stalls"
                  value={patioPopStallNumbers}
                  onChange={(e) => setPatioPopStallNumbers(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="e.g. 1,2,3,4"
                />
              </div>
              <div>
                <Label htmlFor="org-oa-count"># Order Ahead stalls</Label>
                <Input
                  id="org-oa-count"
                  type="number"
                  min={0}
                  value={orderAheadStallCount}
                  onChange={(e) => setOrderAheadStallCount(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label htmlFor="org-oa-stalls">Order Ahead stall #s</Label>
                <Input
                  id="org-oa-stalls"
                  value={orderAheadStallNumbers}
                  onChange={(e) => setOrderAheadStallNumbers(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="e.g. 5,6"
                />
              </div>
              <div>
                <Label htmlFor="org-stall-pop-count"># Stall POP menus</Label>
                <Input
                  id="org-stall-pop-count"
                  type="number"
                  min={0}
                  value={stallPopMenuCount}
                  onChange={(e) => setStallPopMenuCount(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div className="flex items-end">
                <Toggle
                  label="Trailer stall"
                  checked={hasTrailerStall}
                  onChange={setHasTrailerStall}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            {hasTrailerStall && (
              <div>
                <Label htmlFor="org-trailer-num">Trailer stall #</Label>
                <Input
                  id="org-trailer-num"
                  value={trailerStallNumber}
                  onChange={(e) => setTrailerStallNumber(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="e.g. 12"
                />
              </div>
            )}

            {/* Third-party delivery */}
            <SectionHeader>Third-party delivery</SectionHeader>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {THIRD_PARTY_PROVIDERS.map((p) => (
                <Toggle
                  key={p.key}
                  label={p.label}
                  checked={thirdPartyDelivery.includes(p.key)}
                  onChange={(next) => {
                    setThirdPartyDelivery((cur) =>
                      next ? [...cur, p.key] : cur.filter((k) => k !== p.key)
                    );
                  }}
                  disabled={!isAdmin}
                />
              ))}
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
      await qc.refetchQueries({ queryKey: ["org-tree"] });
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

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-zinc-100 pt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-800">
      <input
        type="checkbox"
        className="h-4 w-4 accent-accent disabled:opacity-50"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {label}
    </label>
  );
}

export type { EditTarget, AddTarget };
