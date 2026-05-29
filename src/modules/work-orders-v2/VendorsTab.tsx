// Vendors tab — list, search, add/edit, rate. The list call returns
// each vendor's avg rating + total ratings count, so we render a star
// row inline without a second fetch.
//
// Roles:
//   * Anyone can rate a vendor (1-5 stars + optional comment).
//   * DO+ can add / edit vendors (backend enforces).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Layers, Loader2, Mail, Pencil, Phone, Plus, Star, X } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { downloadCSV, toCSV } from "@/lib/csv";
import {
  bulkEditVendors,
  bulkImportVendors,
  deleteStoreVendorPreference,
  fetchOrgIndex,
  fetchVendorPreferences,
  fetchVendors,
  fetchVendorScopes,
  rateVendor,
  saveStoreVendorPreference,
  saveVendor,
  setVendorScopes,
  type BulkEditBody,
  type BulkEditResult,
  type BulkVendorResult,
  type BulkVendorRow,
  type OrgIndexResponse,
  type VendorPreference,
  type VendorScopeRow,
} from "./api";
import type { SaveVendorBody, Vendor } from "./types";

const ROLE_LEVEL: Record<string, number> = {
  admin: 1, coo: 1, vp: 1,
  rvp: 2, sdo: 2,
  do: 3,
  gm: 4, shift_manager: 5, payroll: 6,
};
function canManage(role: string) {
  return (ROLE_LEVEL[role.toLowerCase()] ?? 99) <= 3;
}

export function VendorsTab({ callerRole }: { callerRole: string }) {
  const toast = useToast();
  const qc = useQueryClient();

  const vendorsQ = useQuery({
    queryKey: ["wo2", "vendors"],
    queryFn: () => fetchVendors(),
    staleTime: 60_000,
  });

  // Org index for resolving vendor_scope_id → label. Fetched once,
  // cached for the session. Used by VendorRow's scope chips and
  // by the in-modal scope editor.
  const orgQ = useQuery({
    queryKey: ["wo2", "org-index"],
    queryFn: fetchOrgIndex,
    staleTime: 5 * 60_000,
  });

  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  // Scope filter — narrows the list to vendors whose scope rows
  // match a given type+id, or "none" for vendors with zero scope
  // rows (legacy fallback). Values look like:
  //   ""             → all
  //   "none"         → no scope rows
  //   "national"
  //   "region:<id>"
  //   "area:<id>"
  //   "district:<id>"
  const [scopeFilter, setScopeFilter] = useState("");
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [rating, setRating] = useState<Vendor | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Multi-select for bulk scope edits. Persists across filter
  // changes — clearing the filter doesn't drop your selection.
  // canManage gating already controls whether checkboxes appear.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen]   = useState(false);
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const vendors = vendorsQ.data?.vendors ?? [];
  const areas = useMemo(() => {
    const set = new Set<string>();
    for (const v of vendors) if (v.service_area) set.add(v.service_area);
    return Array.from(set).sort();
  }, [vendors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (area && (v.service_area || "") !== area) return false;
      if (!matchesScopeFilter(v, scopeFilter)) return false;
      if (!q) return true;
      return [v.name, v.category, v.service_area, v.services, v.phone, v.email, v.contact_person, v.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [vendors, search, area, scopeFilter]);

  return (
    <>
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="flex-1 min-w-[200px]">
          <Label htmlFor="vendor-search">Search</Label>
          <Input
            id="vendor-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Vendor, service, contact…"
          />
        </div>
        <div>
          <Label htmlFor="vendor-area">Service Area</Label>
          <select
            id="vendor-area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All Areas</option>
            {areas.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="vendor-scope-filter">Scope</Label>
          <select
            id="vendor-scope-filter"
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="h-9 min-w-[180px] rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All scopes</option>
            <option value="none">⚠ No scope rows (legacy)</option>
            <option value="national">National</option>
            {orgQ.data?.regions && orgQ.data.regions.length > 0 && (
              <optgroup label="Region">
                {orgQ.data.regions.map((r) => (
                  <option key={r.id} value={`region:${r.id}`}>
                    {r.code ? `${r.code} — ${r.name}` : r.name}
                  </option>
                ))}
              </optgroup>
            )}
            {orgQ.data?.areas && orgQ.data.areas.length > 0 && (
              <optgroup label="Area">
                {orgQ.data.areas.map((a) => (
                  <option key={a.id} value={`area:${a.id}`}>
                    {a.code ? `${a.code} — ${a.name}` : a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {orgQ.data?.districts && orgQ.data.districts.length > 0 && (
              <optgroup label="District">
                {orgQ.data.districts.map((d) => (
                  <option key={d.id} value={`district:${d.id}`}>
                    {d.code ? `${d.code} — ${d.name}` : d.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {canManage(callerRole) && (
          <>
            {callerRole === "admin" && (
              <>
                <Button variant="ghost" onClick={downloadVendorTemplate}>
                  <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                  Template
                </Button>
                <Button variant="ghost" onClick={() => setBulkOpen(true)}>
                  <Layers className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                  Bulk import
                </Button>
              </>
            )}
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Add Vendor
            </Button>
          </>
        )}
      </Card>

      {vendorsQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {vendorsQ.isError && (
        <EmptyState
          title="Couldn't load vendors"
          description={(vendorsQ.error as Error)?.message ?? "Try again."}
        />
      )}
      {!vendorsQ.isLoading && filtered.length === 0 && (
        <EmptyState title="No vendors" description="Try clearing filters or add one." />
      )}

      {canManage(callerRole) && filtered.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
          <button
            type="button"
            onClick={() => {
              const allFilteredIds = filtered.map((v) => v.id);
              const allSelected = allFilteredIds.every((id) => selectedIds.has(id));
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (allSelected) {
                  for (const id of allFilteredIds) next.delete(id);
                } else {
                  for (const id of allFilteredIds) next.add(id);
                }
                return next;
              });
            }}
            className="font-medium text-accent hover:underline"
          >
            {filtered.every((v) => selectedIds.has(v.id))
              ? `Deselect all ${filtered.length}`
              : `Select all ${filtered.length}`}
          </button>
          {selectedIds.size > 0 && (
            <>
              <span>·</span>
              <span>{selectedIds.size} selected</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="font-medium text-accent hover:underline"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((v) => (
          <VendorRow
            key={v.id}
            vendor={v}
            org={orgQ.data}
            canManage={canManage(callerRole)}
            selected={selectedIds.has(v.id)}
            onToggleSelected={() => toggleSelected(v.id)}
            onEdit={() => setEditing(v)}
            onRate={() => setRating(v)}
          />
        ))}
      </div>

      {editing !== null && (
        <VendorEditModal
          vendor={editing === "new" ? null : editing}
          org={orgQ.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.push("Vendor saved.", "success");
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["wo2", "vendors"] });
          }}
          onError={(e) => toast.push(e, "error")}
        />
      )}

      {bulkOpen && callerRole === "admin" && (
        <BulkImportVendorsModal
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["wo2", "vendors"] });
          }}
        />
      )}


      {bulkEditOpen && canManage(callerRole) && selectedIds.size > 0 && (
        <BulkEditVendorsModal
          vendors={vendors.filter((v) => selectedIds.has(v.id))}
          org={orgQ.data}
          onClose={() => setBulkEditOpen(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["wo2", "vendors"] });
            setSelectedIds(new Set());
            setBulkEditOpen(false);
          }}
          onError={(m) => toast.push(m, "error")}
          onSuccess={(m) => toast.push(m, "success")}
        />
      )}

      {/* Sticky action bar when the user has anything selected.
          Renders OUTSIDE the normal flow so it floats above the
          last row regardless of scroll. z-40 to clear sidebar
          (z-50 reserved for mobile drawer). Inner container wraps
          on narrow widths so buttons stay visible on phones.
          Safe-area inset for iOS home-bar overlap. */}
      {canManage(callerRole) && selectedIds.size > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white shadow-2xl"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
            <div className="text-xs text-zinc-700">
              <span className="font-semibold">
                {selectedIds.size} vendor{selectedIds.size === 1 ? "" : "s"} selected
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
              <Button variant="primary" onClick={() => setBulkEditOpen(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Edit {selectedIds.size} selected
              </Button>
            </div>
          </div>
        </div>
      )}

      {rating && (
        <RateVendorModal
          vendor={rating}
          onClose={() => setRating(null)}
          onRated={() => {
            toast.push("Rating submitted.", "success");
            setRating(null);
            qc.invalidateQueries({ queryKey: ["wo2", "vendors"] });
          }}
          onError={(e) => toast.push(e, "error")}
        />
      )}
    </>
  );
}

function VendorRow({
  vendor,
  org,
  canManage,
  selected,
  onToggleSelected,
  onEdit,
  onRate,
}: {
  vendor: Vendor;
  org: OrgIndexResponse | undefined;
  canManage: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onEdit: () => void;
  onRate: () => void;
}) {
  const services = (vendor.services || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const scopeChips = useMemo(
    () => buildScopeChips(vendor.vendor_scopes || [], org),
    [vendor.vendor_scopes, org],
  );
  return (
    <Card className={selected ? "ring-2 ring-accent/40" : undefined}>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {canManage && (
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelected}
                className="mt-1 h-4 w-4 shrink-0 accent-accent"
                aria-label={`Select ${vendor.name}`}
              />
            )}
            <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-semibold text-midnight">{vendor.name}</div>
              <Stars rating={vendor.avgRating} total={vendor.totalRatings} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
              {vendor.category && <span className="font-medium text-accent">{vendor.category}</span>}
              {vendor.service_area && <span>📍 {vendor.service_area}</span>}
              {vendor.contact_person && <span>👤 {vendor.contact_person}</span>}
            </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {vendor.phone && (
              <a
                href={`tel:${vendor.phone.replace(/\D/g, "")}`}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <Phone className="h-3 w-3" strokeWidth={1.75} />
                {vendor.phone}
              </a>
            )}
            {vendor.email && (
              <a
                href={`mailto:${vendor.email}`}
                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                <Mail className="h-3 w-3" strokeWidth={1.75} />
                Email
              </a>
            )}
            <button
              type="button"
              onClick={onRate}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:border-amber-300 hover:text-amber-600"
            >
              <Star className="h-3 w-3" strokeWidth={1.75} />
              Rate
            </button>
            {canManage && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:border-accent hover:text-midnight"
              >
                <Pencil className="h-3 w-3" strokeWidth={1.75} />
                Edit
              </button>
            )}
          </div>
        </div>
        {scopeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Scope:
            </span>
            {scopeChips.map((c) => (
              <span
                key={c.key}
                className={
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium " +
                  (c.tone === "national"
                    ? "bg-emerald-100 text-emerald-900"
                    : c.tone === "region"
                      ? "bg-violet-100 text-violet-900"
                      : c.tone === "area"
                        ? "bg-blue-100 text-blue-900"
                        : c.tone === "district"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-zinc-100 text-zinc-700")
                }
              >
                {c.label}
              </span>
            ))}
          </div>
        )}
        {services.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {services.map((s) => (
              <span
                key={s}
                className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-600"
              >
                {s}
              </span>
            ))}
          </div>
        )}
        {vendor.notes && (
          <div className="text-xs text-amber-700">📌 {vendor.notes}</div>
        )}
      </CardBody>
    </Card>
  );
}

function Stars({ rating, total }: { rating: number | null; total: number }) {
  if (rating === null) return null;
  const rounded = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5 text-xs">
      <span className="text-amber-500">
        {"★".repeat(rounded)}
        {"☆".repeat(5 - rounded)}
      </span>
      <span className="text-zinc-500">
        {rating.toFixed(1)} ({total})
      </span>
    </span>
  );
}

// ── Edit modal ───────────────────────────────────────────────

function VendorEditModal({
  vendor,
  org,
  onClose,
  onSaved,
  onError,
}: {
  vendor: Vendor | null;
  org: OrgIndexResponse | undefined;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(vendor?.name || "");
  const [category, setCategory] = useState(vendor?.category || "");
  const [serviceArea, setServiceArea] = useState(vendor?.service_area || "");
  const [services, setServices] = useState(vendor?.services || "");
  const [contactPerson, setContactPerson] = useState(vendor?.contact_person || "");
  const [phone, setPhone] = useState(vendor?.phone || "");
  const [email, setEmail] = useState(vendor?.email || "");
  const [website, setWebsite] = useState(vendor?.website || "");
  const [notes, setNotes] = useState(vendor?.notes || "");
  // is_internal marks an in-house tech / internal facilities
  // resource. Renders an "Internal" chip in the vendor typeahead
  // and lets reporting split internal vs external by group-by.
  const [isInternal, setIsInternal] = useState<boolean>(!!vendor?.is_internal);

  // Warranty defaults. Stored as days under the hood; the UI shows
  // a "≈ N months" hint next to the input. Source enum captures
  // who actually backs the parts warranty (vendor vs manufacturer
  // pass-through).
  const [laborDays, setLaborDays] = useState<string>(
    vendor?.labor_warranty_days != null ? String(vendor.labor_warranty_days) : "",
  );
  const [partsDays, setPartsDays] = useState<string>(
    vendor?.parts_warranty_days != null ? String(vendor.parts_warranty_days) : "",
  );
  const [partsSource, setPartsSource] = useState<"" | "vendor" | "manufacturer" | "none">(
    vendor?.parts_warranty_source ?? "",
  );
  const [warrantyNotes, setWarrantyNotes] = useState(vendor?.warranty_notes || "");

  // Scope editor state. Holds the desired list of scope rows for
  // this vendor. We fetch existing rows on mount (for an edit),
  // then mutate locally; on save, we push the full desired list to
  // setVendorScopes which wipes + replaces.
  const scopesQ = useQuery({
    queryKey: ["wo2", "vendor-scopes", vendor?.id || "new"],
    queryFn: () => fetchVendorScopes(vendor!.id),
    enabled: !!vendor,
    staleTime: 60_000,
  });
  const [draftScopes, setDraftScopes] = useState<Array<{
    scope_type: "national" | "region" | "area" | "district" | "store";
    scope_id: string | null;
  }>>([]);
  useEffect(() => {
    if (scopesQ.data?.scopes) {
      setDraftScopes(scopesQ.data.scopes.map((s) => ({
        scope_type: s.scope_type, scope_id: s.scope_id,
      })));
    }
  }, [scopesQ.data]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Vendor name is required.");
      // Warranty days: empty string → null (clears the field).
      // Anything else parsed as int; non-numeric ignored (kept null).
      const labWarN  = laborDays.trim()  === "" ? null : Number(laborDays);
      const partWarN = partsDays.trim()  === "" ? null : Number(partsDays);
      const payload: SaveVendorBody = {
        name: name.trim(),
        category: category || undefined,
        service_area: serviceArea || undefined,
        services: services || undefined,
        contact_person: contactPerson || undefined,
        phone: phone || undefined,
        email: email || undefined,
        website: website || undefined,
        notes: notes || undefined,
        is_internal: isInternal,
        labor_warranty_days:   Number.isFinite(labWarN as number)  ? (labWarN as number)  : null,
        parts_warranty_days:   Number.isFinite(partWarN as number) ? (partWarN as number) : null,
        parts_warranty_source: partsSource || null,
        warranty_notes:        warrantyNotes || null,
      };
      if (vendor) payload.id = vendor.id;
      // Save vendor first — for a new vendor we need the returned
      // id before we can persist scope rows against it.
      const saveRes = await saveVendor(payload);
      const vendorId = vendor?.id || saveRes.vendor?.id;
      if (vendorId) {
        await setVendorScopes(vendorId, draftScopes);
      }
      return saveRes;
    },
    onSuccess: onSaved,
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Save failed."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            {vendor ? "Edit Vendor" : "Add Vendor"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="vm-name">Name *</Label>
              <Input id="vm-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vm-cat">Category</Label>
              <Input id="vm-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="vm-area">Service Area</Label>
            <Input id="vm-area" value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="vm-contact">Contact Person</Label>
              <Input id="vm-contact" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vm-phone">Phone</Label>
              <Input id="vm-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="vm-email">Email</Label>
              <Input id="vm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vm-web">Website</Label>
              <Input id="vm-web" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="vm-services">Services (comma separated)</Label>
            <Input
              id="vm-services"
              value={services}
              onChange={(e) => setServices(e.target.value)}
              placeholder="e.g. Fryer, HVAC, Ice Machine"
            />
          </div>
          <div>
            <Label htmlFor="vm-notes">Notes</Label>
            <Input id="vm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
              />
              <span>
                <span className="font-semibold text-midnight">In-house tech / internal resource</span>
                <span className="ml-1 text-xs text-zinc-500">
                  — shows as an &ldquo;Internal&rdquo; chip in vendor pickers; reporting can split internal vs external.
                </span>
              </span>
            </label>
          </div>

          {/* Warranty defaults — auto-populated onto a ticket when
              this vendor marks it completed. DO can still override
              per-ticket. */}
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-semibold tracking-tight text-midnight">
                Warranty (default offer)
              </div>
              <span className="text-[10px] text-zinc-500">
                Copied onto every ticket this vendor completes. Editable per-ticket later.
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="vm-labor">Labor warranty (days)</Label>
                <Input
                  id="vm-labor" type="number" min={0}
                  value={laborDays}
                  onChange={(e) => setLaborDays(e.target.value)}
                  placeholder="e.g. 90"
                />
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  {daysHint(laborDays)} · covers vendor workmanship
                </div>
              </div>
              <div>
                <Label htmlFor="vm-parts">Parts warranty (days)</Label>
                <Input
                  id="vm-parts" type="number" min={0}
                  value={partsDays}
                  onChange={(e) => setPartsDays(e.target.value)}
                  placeholder="e.g. 365"
                />
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  {daysHint(partsDays)} · covers replacement parts
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Label>Parts warranty source</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {([
                  { v: "vendor",       label: "Vendor-backed",          desc: "Vendor honors directly" },
                  { v: "manufacturer", label: "Manufacturer pass-through", desc: "Vendor files claim with mfg" },
                  { v: "none",         label: "None",                    desc: "No parts warranty" },
                ] as const).map((opt) => (
                  <label
                    key={opt.v}
                    className={
                      "flex cursor-pointer items-start gap-2 rounded-md border bg-white px-2.5 py-1.5 text-xs " +
                      (partsSource === opt.v ? "border-accent ring-1 ring-accent/40" : "border-zinc-200 hover:border-accent")
                    }
                  >
                    <input
                      type="radio"
                      name="parts-source"
                      checked={partsSource === opt.v}
                      onChange={() => setPartsSource(opt.v)}
                      className="mt-0.5 h-3 w-3 accent-accent"
                    />
                    <span>
                      <span className="font-medium text-midnight">{opt.label}</span>
                      <span className="ml-1 text-[10px] text-zinc-500">{opt.desc}</span>
                    </span>
                  </label>
                ))}
                {partsSource !== "" && (
                  <button
                    type="button"
                    onClick={() => setPartsSource("")}
                    className="text-[11px] text-zinc-500 underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="vm-warranty-notes">Warranty notes (optional)</Label>
              <Input
                id="vm-warranty-notes"
                value={warrantyNotes}
                onChange={(e) => setWarrantyNotes(e.target.value)}
                placeholder="e.g. Excludes gaskets and seals. Must report failure within 48h."
              />
            </div>
          </div>

          {/* Scope editor — controls which stores see this vendor. */}
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-semibold tracking-tight text-midnight">
                Scope
              </div>
              <span className="text-[10px] text-zinc-500">
                Which stores see this vendor. Empty = visible to all (legacy fallback).
              </span>
            </div>
            <ScopeEditor
              org={org}
              scopes={draftScopes}
              loading={!!vendor && scopesQ.isLoading}
              onChange={setDraftScopes}
            />
          </div>

          {/* Preferred Vendor editor — per-store rank. Only available
              for vendors that are already saved (have an id) so the
              preference rows can FK to them. */}
          {vendor && (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold tracking-tight text-midnight">
                  Preferred at
                </div>
                <span className="text-[10px] text-zinc-500">
                  Stores where this vendor is primary/backup for a category.
                  Sorts to the top of the picker.
                </span>
              </div>
              <PreferenceEditor vendor={vendor} org={org} />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {vendor ? "Save Changes" : "Add Vendor"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Rate modal ───────────────────────────────────────────────

function RateVendorModal({
  vendor,
  onClose,
  onRated,
  onError,
}: {
  vendor: Vendor;
  onClose: () => void;
  onRated: () => void;
  onError: (msg: string) => void;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");

  const mut = useMutation({
    mutationFn: () => {
      if (!stars) return Promise.reject(new Error("Pick a star rating."));
      return rateVendor({
        vendorId: vendor.id,
        rating: stars,
        comment: comment.trim() || undefined,
      });
    },
    onSuccess: onRated,
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Rating failed."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            Rate {vendor.name}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label>Rating *</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setStars(n)}
                  className={
                    "p-1 transition " +
                    (n <= stars ? "text-amber-500" : "text-zinc-300 hover:text-amber-400")
                  }
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                >
                  <Star className="h-7 w-7" strokeWidth={1.75} fill={n <= stars ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][stars]}
            </div>
          </div>
          <div>
            <Label htmlFor="rv-comment">Comment (optional)</Label>
            <textarea
              id="rv-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="How did the vendor perform?"
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Submit Rating
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk import modal ──────────────────────────────────────────
// Admin-only. Accepts a paste of tab-separated or comma-separated
// vendor rows (TSV preferred — easier for users copying out of a
// spreadsheet). First row is treated as a header so users can pick
// which columns map to which fields.
//
// Columns recognized (case-insensitive, any subset):
//   name (required), category, services, service_area,
//   contact_person, email, phone, notes, website,
//   is_active, scope
//
// Scope examples: "national" | "district:Edmond" |
// "store:1242,1245" | "district:Edmond | store:1601".

const RECOGNIZED_FIELDS = [
  "name", "category", "services", "service_area",
  "contact_person", "email", "phone", "notes", "website",
  "is_active", "scope",
  // Warranty default fields. Days as integers; source one of
  // 'vendor' / 'manufacturer' / 'none' (lenient parser accepts
  // 'mfg', 'pass-through', etc.).
  "labor_warranty_days", "parts_warranty_days",
  "parts_warranty_source", "warranty_notes",
] as const;

type ImportField = typeof RECOGNIZED_FIELDS[number];

// Two example rows shipped in the downloadable template so users see
// the expected shape for every recognized column — especially the
// fiddly ones (scope syntax, warranty source values, is_active
// booleans). The parser ignores unknown columns and these examples
// are safe to delete/overwrite before importing.
const TEMPLATE_ROWS: Record<ImportField, string>[] = [
  {
    name: "Kniatt Mechanical LLC",
    category: "HVAC, Ice Machine",
    services: "Walk-In Cooler, Fryer",
    service_area: "Dallas Area",
    contact_person: "Sam Kniatt",
    email: "service@kniattmech.com",
    phone: "(940) 453-7404",
    notes: "Preferred for refrigeration emergencies",
    website: "https://kniattmech.com",
    is_active: "true",
    scope: "district:Dallas Metro | store:1242,1245",
    labor_warranty_days: "90",
    parts_warranty_days: "365",
    parts_warranty_source: "manufacturer",
    warranty_notes: "Compressor parts carry mfg warranty",
  },
  {
    name: "Lone Star Plumbing",
    category: "Plumbing",
    services: "Drains, Water Heaters",
    service_area: "Statewide",
    contact_person: "Dana Reyes",
    email: "dispatch@lonestarplumbing.com",
    phone: "(800) 555-0142",
    notes: "",
    website: "",
    is_active: "true",
    scope: "national",
    labor_warranty_days: "30",
    parts_warranty_days: "",
    parts_warranty_source: "vendor",
    warranty_notes: "",
  },
];

function downloadVendorTemplate() {
  const csv = toCSV([...RECOGNIZED_FIELDS], TEMPLATE_ROWS);
  downloadCSV("vendor-import-template.csv", csv);
}

function BulkImportVendorsModal({
  onClose, onDone,
}: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pasted, setPasted] = useState("");
  const [replaceScopes, setReplaceScopes] = useState(true);
  const [results, setResults] = useState<BulkVendorResult[] | null>(null);

  const parsed = useMemo(() => parsePastedTable(pasted), [pasted]);

  const mut = useMutation({
    mutationFn: () => {
      if (parsed.rows.length === 0) {
        return Promise.reject(new Error("No rows to import."));
      }
      const missingName = parsed.rows.some((r) => !r.name?.trim());
      if (missingName) {
        return Promise.reject(new Error("Every row must have a name."));
      }
      return bulkImportVendors(parsed.rows as unknown as BulkVendorRow[], replaceScopes);
    },
    onSuccess: (r) => {
      setResults(r.results);
      onDone();
      const { created = 0, updated = 0, failed = 0 } = r.summary;
      toast.push(
        `${created} created · ${updated} updated · ${failed} failed`,
        failed ? "error" : "success",
      );
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Import failed.", "error"),
  });

  const showResults = results !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !mut.isPending) onClose(); }}
    >
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold text-midnight">
            Bulk import vendors
          </div>
          <div className="flex items-center gap-1">
            {!showResults && (
              <Button variant="ghost" size="sm" onClick={downloadVendorTemplate}>
                <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Template
              </Button>
            )}
            <button
              type="button" onClick={onClose} disabled={mut.isPending}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {!showResults ? (
          <>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                <div className="font-semibold text-midnight">How to format</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>
                    First row = header. Recognized columns:{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">
                      name, category, services, service_area, contact_person,
                      email, phone, notes, website, is_active, scope,
                      labor_warranty_days, parts_warranty_days,
                      parts_warranty_source, warranty_notes
                    </code>
                  </li>
                  <li>
                    Paste from a spreadsheet (tab-separated) or use commas —
                    we auto-detect.
                  </li>
                  <li>
                    <strong>scope</strong> column accepts:{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">national</code>,{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">region:R04</code> /{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">region:OK Region</code>,{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">area:</code> or{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">district:</code> followed by
                    one or more codes <em>or</em> names (comma-separated),{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">store:1242,1245</code>,
                    or combinations separated by{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">|</code>.{" "}
                    <strong>Codes are recommended</strong> — they don't break if you rename a region.
                  </li>
                  <li>
                    Rows match existing vendors by <strong>name</strong> (unique).
                    Matches are <strong>updated</strong>, new names become new vendors.
                  </li>
                  <li>
                    Not sure where to start? Hit{" "}
                    <strong>Template</strong> (top right) for a CSV with every
                    column and two example rows — open it in Excel/Sheets, fill
                    in your vendors, then paste back here.
                  </li>
                </ul>
              </div>

              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={12}
                placeholder={"name\tcategory\tservices\tservice_area\tphone\tscope\nKniatt Mechanical LLC\tHVAC, Ice Machine\tWalk-In Cooler, Fryer\tDallas Area\t(940) 453-7404\tdistrict:Dallas Metro"}
                className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-[11px] text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />

              {parsed.errors.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <div className="font-semibold">Header issues</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {parsed.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              {parsed.rows.length > 0 && parsed.errors.length === 0 && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Parsed <strong>{parsed.rows.length}</strong> row{parsed.rows.length === 1 ? "" : "s"}
                  {" · "}columns detected:{" "}
                  <span className="font-mono">{parsed.detectedFields.join(", ")}</span>
                </div>
              )}

              <label className="mt-2 flex items-center gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={replaceScopes}
                  onChange={(e) => setReplaceScopes(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Replace each vendor's existing scopes with the ones in this import
                (uncheck to <em>add</em> scopes instead of replacing).
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
              <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => mut.mutate()}
                disabled={mut.isPending || parsed.rows.length === 0 || parsed.errors.length > 0}
              >
                {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {mut.isPending
                  ? `Importing ${parsed.rows.length}…`
                  : `Import ${parsed.rows.length} vendor${parsed.rows.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        ) : (
          <BulkResultsView results={results || []} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function BulkResultsView({
  results, onClose,
}: { results: BulkVendorResult[]; onClose: () => void }) {
  const created = results.filter((r) => r.status === "created");
  const updated = results.filter((r) => r.status === "updated");
  const failed  = results.filter((r) => r.status === "failed");

  return (
    <>
      <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          <ResultTile tone="success" count={created.length} label="Created" />
          <ResultTile tone="info"    count={updated.length} label="Updated" />
          <ResultTile tone="danger"  count={failed.length}  label="Failed" />
        </div>
        {failed.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-red-900">
              Failures
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-red-900">
              {failed.map((r) => (
                <li key={r.row}>
                  <span className="font-mono">Row {r.row} · {r.name || "—"}</span>:{" "}
                  {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className="rounded-md border border-zinc-200 bg-white p-3 text-xs">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Full breakdown ({results.length})
          </summary>
          <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
            {results.map((r) => (
              <li key={r.row} className="flex items-center gap-2">
                {r.status === "created" && <CheckCircle2 className="h-3 w-3 text-emerald-600" strokeWidth={2} />}
                {r.status === "updated" && <span className="h-3 w-3 rounded-full bg-blue-400" />}
                {r.status === "failed"  && <X className="h-3 w-3 text-red-600" strokeWidth={2} />}
                <span className="font-mono">{r.name}</span>
                {typeof r.scopes === "number" && (
                  <span className="text-zinc-500">— {r.scopes} scope{r.scopes === 1 ? "" : "s"}</span>
                )}
                {r.message && <span className="text-zinc-500">— {r.message}</span>}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}

function ResultTile({
  tone, count, label,
}: { tone: "success" | "info" | "danger"; count: number; label: string }) {
  const cls =
    tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" :
    tone === "info"    ? "border-blue-200 bg-blue-50 text-blue-900" :
                         "border-red-200 bg-red-50 text-red-900";
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`}>
      <div className="text-lg font-semibold tabular-nums">{count}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide">{label}</div>
    </div>
  );
}

// Parse pasted tabular text into vendor rows. Auto-detects tab vs
// comma delimiter (preferring tab if any line has one — usually the
// case when copied from Excel/Sheets). First non-blank line is the
// header; columns not in RECOGNIZED_FIELDS are ignored.
function parsePastedTable(raw: string): {
  rows: Array<Record<string, string>>;
  detectedFields: ImportField[];
  errors: string[];
} {
  const out = { rows: [] as Array<Record<string, string>>, detectedFields: [] as ImportField[], errors: [] as string[] };
  const text = raw.trim();
  if (!text) return out;

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    out.errors.push("Need at least a header row + 1 data row.");
    return out;
  }
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headerCells = lines[0].split(delim).map((c) => c.trim().toLowerCase());
  const fieldMap: (ImportField | null)[] = headerCells.map((h) => {
    const norm = h.replace(/\s+/g, "_");
    return (RECOGNIZED_FIELDS as readonly string[]).includes(norm)
      ? (norm as ImportField)
      : null;
  });
  const detected = fieldMap.filter((f): f is ImportField => f !== null);
  out.detectedFields = detected;

  if (!detected.includes("name")) {
    out.errors.push('Header must include a "name" column.');
    return out;
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delim).map((c) => c.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < fieldMap.length; j++) {
      const field = fieldMap[j];
      if (!field) continue;
      row[field] = cells[j] || "";
    }
    if (row.name) out.rows.push(row);
  }
  return out;
}

// ── Scope editor ─────────────────────────────────────────────
// Inline editor used inside VendorEditModal. Shows the current
// scope rows as chips with remove buttons, plus an "Add scope"
// picker (type select + target select). Returns updates via
// onChange — the parent is responsible for persisting on save.
//
// The picker hides the second select until a non-'national' type
// is chosen. "national" stands alone and only one row of it is
// allowed at a time (enforced by the partial unique index in 0046,
// also de-duped client-side).

type ScopeDraft = { scope_type: VendorScopeRow["scope_type"]; scope_id: string | null };

function ScopeEditor({
  org,
  scopes,
  loading,
  onChange,
}: {
  org: OrgIndexResponse | undefined;
  scopes: ScopeDraft[];
  loading: boolean;
  onChange: (next: ScopeDraft[]) => void;
}) {
  const [pendingType, setPendingType] = useState<VendorScopeRow["scope_type"] | "">("");
  const [pendingTarget, setPendingTarget] = useState<string>("");

  // Build option lists for the target select based on pendingType.
  const targetOptions = useMemo(() => {
    if (!org) return [];
    switch (pendingType) {
      case "region":
        return org.regions.map((r) => ({
          id: r.id,
          label: r.code ? `${r.code} — ${r.name}` : r.name,
        }));
      case "area":
        return org.areas.map((a) => ({
          id: a.id,
          label: a.code ? `${a.code} — ${a.name}` : a.name,
        }));
      case "district":
        return org.districts.map((d) => ({
          id: d.id,
          label: d.code ? `${d.code} — ${d.name}` : d.name,
        }));
      case "store":
        return org.stores.map((s) => ({
          id: s.id,
          label: s.name ? `#${s.number} — ${s.name}` : `#${s.number}`,
        }));
      default:
        return [];
    }
  }, [pendingType, org]);

  function addScope() {
    if (!pendingType) return;
    if (pendingType === "national") {
      // Don't add a duplicate national row.
      if (scopes.some((s) => s.scope_type === "national")) return;
      onChange([...scopes, { scope_type: "national", scope_id: null }]);
    } else {
      if (!pendingTarget) return;
      if (scopes.some((s) => s.scope_type === pendingType && s.scope_id === pendingTarget)) {
        return; // already in the list
      }
      onChange([...scopes, { scope_type: pendingType, scope_id: pendingTarget }]);
    }
    setPendingType("");
    setPendingTarget("");
  }

  function removeAt(idx: number) {
    onChange(scopes.filter((_, i) => i !== idx));
  }

  if (loading) {
    return <div className="mt-2 text-xs text-zinc-500">Loading scopes…</div>;
  }

  return (
    <div className="mt-2 space-y-2">
      {scopes.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-300 bg-white px-3 py-2 text-[11px] text-zinc-500">
          No scope rows yet — this vendor is currently visible to every store.
          Add a scope below to restrict.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {scopes.map((s, i) => (
            <ScopeDraftChip
              key={`${s.scope_type}:${s.scope_id ?? "national"}:${i}`}
              draft={s}
              org={org}
              onRemove={() => removeAt(i)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-white p-2">
        <select
          value={pendingType}
          onChange={(e) => {
            setPendingType(e.target.value as VendorScopeRow["scope_type"] | "");
            setPendingTarget("");
          }}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
        >
          <option value="">Pick scope type…</option>
          <option value="national">National</option>
          <option value="region">Region</option>
          <option value="area">Area</option>
          <option value="district">District</option>
          <option value="store">Store</option>
        </select>
        {pendingType && pendingType !== "national" && (
          <select
            value={pendingTarget}
            onChange={(e) => setPendingTarget(e.target.value)}
            className="h-8 min-w-[200px] flex-1 rounded-md border border-zinc-200 bg-white px-2 text-xs"
          >
            <option value="">Pick {pendingType}…</option>
            {targetOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        )}
        <Button
          variant="primary"
          onClick={addScope}
          disabled={!pendingType || (pendingType !== "national" && !pendingTarget)}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function ScopeDraftChip({
  draft, org, onRemove,
}: {
  draft: ScopeDraft;
  org: OrgIndexResponse | undefined;
  onRemove: () => void;
}) {
  const label = draftLabel(draft, org);
  const tone =
    draft.scope_type === "national" ? "bg-emerald-100 text-emerald-900" :
    draft.scope_type === "region"   ? "bg-violet-100 text-violet-900" :
    draft.scope_type === "area"     ? "bg-blue-100 text-blue-900" :
    draft.scope_type === "district" ? "bg-amber-100 text-amber-900" :
                                      "bg-zinc-100 text-zinc-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>
      {label}
      <button
        type="button" onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 hover:bg-black/10"
        aria-label="Remove"
      >
        <X className="h-2.5 w-2.5" strokeWidth={2} />
      </button>
    </span>
  );
}

// ── Preference editor ─────────────────────────────────────────
// Lives inside the vendor edit modal. Reads per-vendor preference
// rows and renders them as a list with add/remove. Mutations
// invalidate the local query so the list re-fetches.
function PreferenceEditor({
  vendor, org,
}: {
  vendor: Vendor;
  org: OrgIndexResponse | undefined;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const prefsQ = useQuery({
    queryKey: ["wo2", "vendor-prefs", vendor.id],
    queryFn: () => fetchVendorPreferences(vendor.id),
    staleTime: 30_000,
  });
  const [pickedStoreId, setPickedStoreId] = useState("");
  const [pickedCategory, setPickedCategory] = useState("");
  const [pickedRank, setPickedRank] = useState("1");

  const addMut = useMutation({
    mutationFn: () => {
      if (!pickedStoreId) throw new Error("Pick a store.");
      if (!pickedCategory.trim()) throw new Error("Category is required.");
      return saveStoreVendorPreference({
        store_id: pickedStoreId,
        vendor_id: vendor.id,
        category: pickedCategory.trim(),
        rank: Number(pickedRank) || 1,
      });
    },
    onSuccess: () => {
      setPickedStoreId("");
      setPickedCategory("");
      setPickedRank("1");
      qc.invalidateQueries({ queryKey: ["wo2", "vendor-prefs", vendor.id] });
      toast.push("Preference saved.", "success");
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteStoreVendorPreference(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wo2", "vendor-prefs", vendor.id] });
      toast.push("Preference removed.", "info");
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Remove failed.", "error"),
  });

  const prefs = prefsQ.data?.preferences || [];
  const vendorCategories = (vendor.category || "")
    .split(",").map((c) => c.trim()).filter(Boolean);

  return (
    <div className="mt-2 space-y-2">
      {prefsQ.isLoading ? (
        <div className="text-xs text-zinc-500">Loading…</div>
      ) : prefs.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-300 bg-white px-3 py-2 text-[11px] text-zinc-500">
          No preferences yet. Add one below to make this vendor the primary or
          backup for a category at a specific store.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white">
          {prefs.map((p) => <PreferenceRow key={p.id} pref={p} onRemove={() => delMut.mutate(p.id)} pending={delMut.isPending} />)}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-white p-2">
        <select
          value={pickedStoreId}
          onChange={(e) => setPickedStoreId(e.target.value)}
          className="h-8 min-w-[180px] rounded-md border border-zinc-200 bg-white px-2 text-xs"
        >
          <option value="">Pick store…</option>
          {(org?.stores || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ? `#${s.number} — ${s.name}` : `#${s.number}`}
            </option>
          ))}
        </select>
        {vendorCategories.length > 0 ? (
          <select
            value={pickedCategory}
            onChange={(e) => setPickedCategory(e.target.value)}
            className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
          >
            <option value="">Pick category…</option>
            {vendorCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="__custom__">Other (type below)…</option>
          </select>
        ) : null}
        {(vendorCategories.length === 0 || pickedCategory === "__custom__") && (
          <Input
            value={pickedCategory === "__custom__" ? "" : pickedCategory}
            onChange={(e) => setPickedCategory(e.target.value)}
            placeholder="Category (e.g. HVAC)"
            className="h-8 w-[160px] text-xs"
          />
        )}
        <select
          value={pickedRank}
          onChange={(e) => setPickedRank(e.target.value)}
          className="h-8 w-[110px] rounded-md border border-zinc-200 bg-white px-2 text-xs"
        >
          <option value="1">1 — primary</option>
          <option value="2">2 — backup</option>
          <option value="3">3 — third</option>
        </select>
        <Button
          variant="primary"
          onClick={() => addMut.mutate()}
          disabled={addMut.isPending || !pickedStoreId || !pickedCategory.trim() || pickedCategory === "__custom__"}
        >
          {addMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
        </Button>
      </div>
    </div>
  );
}

function PreferenceRow({
  pref, onRemove, pending,
}: {
  pref: VendorPreference;
  onRemove: () => void;
  pending: boolean;
}) {
  const rankLabel = pref.rank === 1 ? "primary" : pref.rank === 2 ? "backup" : `rank ${pref.rank}`;
  return (
    <li className="flex items-center justify-between px-3 py-2 text-xs">
      <div>
        <span className="font-mono font-semibold text-midnight">
          #{pref.stores?.number || "—"}
        </span>
        {pref.stores?.name && <span className="ml-1 text-zinc-500">{pref.stores.name}</span>}
        <span className="mx-2 text-zinc-400">·</span>
        <span className="text-midnight">{pref.category}</span>
        <span className="mx-2 text-zinc-400">·</span>
        <span className={
          pref.rank === 1
            ? "rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900"
            : "rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700"
        }>
          {rankLabel}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={pending}
        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 disabled:opacity-50"
        aria-label="Remove"
      >
        <X className="h-3 w-3" strokeWidth={1.75} />
      </button>
    </li>
  );
}

function draftLabel(s: ScopeDraft, org: OrgIndexResponse | undefined): string {
  if (s.scope_type === "national") return "National";
  if (!org) return `${s.scope_type}: ${s.scope_id ?? "?"}`;
  if (s.scope_type === "region") {
    const r = org.regions.find((x) => x.id === s.scope_id);
    return r ? `Region: ${r.code || r.name}` : `Region: ?`;
  }
  if (s.scope_type === "area") {
    const a = org.areas.find((x) => x.id === s.scope_id);
    return a ? `Area: ${a.code || a.name}` : `Area: ?`;
  }
  if (s.scope_type === "district") {
    const d = org.districts.find((x) => x.id === s.scope_id);
    return d ? `District: ${d.code || d.name}` : `District: ?`;
  }
  if (s.scope_type === "store") {
    const st = org.stores.find((x) => x.id === s.scope_id);
    return st ? `Store #${st.number}` : `Store: ?`;
  }
  return s.scope_type;
}

// Build a flat list of scope chips for a vendor row. Resolves each
// scope_id against the org index so the chip label is "Edmond
// District" instead of a UUID. Unresolved IDs (stale references)
// render as "<type>: ?" so they're still visible — not silently
// dropped.
interface ScopeChip {
  key: string;
  label: string;
  tone: "national" | "region" | "area" | "district" | "store";
}

function buildScopeChips(
  scopes: NonNullable<Vendor["vendor_scopes"]>,
  org: OrgIndexResponse | undefined,
): ScopeChip[] {
  if (!scopes.length) return [];
  const chips: ScopeChip[] = [];
  const regionsById   = new Map((org?.regions   || []).map((r) => [r.id, r]));
  const areasById     = new Map((org?.areas     || []).map((a) => [a.id, a]));
  const districtsById = new Map((org?.districts || []).map((d) => [d.id, d]));
  const storesById    = new Map((org?.stores    || []).map((s) => [s.id, s]));
  for (const s of scopes) {
    if (s.scope_type === "national") {
      chips.push({ key: "national", label: "National", tone: "national" });
      continue;
    }
    const id = s.scope_id || "";
    const key = `${s.scope_type}:${id}`;
    let label = `${s.scope_type}: ?`;
    if (s.scope_type === "region" && regionsById.has(id)) {
      const r = regionsById.get(id)!;
      label = r.code || r.name;
    } else if (s.scope_type === "area" && areasById.has(id)) {
      const a = areasById.get(id)!;
      label = a.code || a.name;
    } else if (s.scope_type === "district" && districtsById.has(id)) {
      const d = districtsById.get(id)!;
      label = d.code || d.name;
    } else if (s.scope_type === "store" && storesById.has(id)) {
      const st = storesById.get(id)!;
      label = `#${st.number}`;
    }
    chips.push({ key, label, tone: s.scope_type });
  }
  return chips;
}

// "90" → "≈ 3 months"; empty / non-numeric → "".
function daysHint(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n === 1) return "≈ 1 day";
  if (n < 30) return `≈ ${n} days`;
  if (n < 60) return "≈ 1 month";
  const months = Math.round(n / 30);
  if (months < 12) return `≈ ${months} months`;
  const years = Math.round((n / 365) * 10) / 10;
  return years === 1 ? "≈ 1 year" : `≈ ${years} years`;
}

// ── Bulk edit modal ────────────────────────────────────────────
// Three checkbox-gated sections: Status (activate/deactivate),
// Warranty defaults, and Scope. The user opts each section in,
// configures it, and submits — only opted-in sections are applied.
// Single backend call (bulkEditVendors) for the whole batch.

function BulkEditVendorsModal({
  vendors, org, onClose, onDone, onError, onSuccess,
}: {
  vendors: Vendor[];
  org: OrgIndexResponse | undefined;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  // Section opt-ins.
  const [doStatus,   setDoStatus]   = useState(false);
  const [doWarranty, setDoWarranty] = useState(false);
  const [doScope,    setDoScope]    = useState(false);

  // Section state.
  const [statusActive, setStatusActive] = useState<"active" | "inactive">("active");

  const [laborDays, setLaborDays]   = useState("");
  const [partsDays, setPartsDays]   = useState("");
  const [partsSource, setPartsSource] = useState<"" | "vendor" | "manufacturer" | "none">("");
  const [warrantyNotes, setWarrantyNotes] = useState("");
  // Per-warranty-field "clear" toggle so the user can intentionally
  // wipe a field on all selected vendors.
  const [clearLaborDays,   setClearLaborDays]   = useState(false);
  const [clearPartsDays,   setClearPartsDays]   = useState(false);
  const [clearPartsSource, setClearPartsSource] = useState(false);
  const [clearNotes,       setClearNotes]       = useState(false);

  const [draftScopes, setDraftScopes] = useState<ScopeDraft[]>([]);
  const [scopeMode,   setScopeMode]   = useState<"replace" | "add">("add");

  const [results, setResults] = useState<BulkEditResult[] | null>(null);

  const validWarranty = !doWarranty || (
    // At least one warranty field has a value OR is being cleared
    (clearLaborDays   || laborDays.trim()     !== "") ||
    (clearPartsDays   || partsDays.trim()     !== "") ||
    (clearPartsSource || partsSource          !== "") ||
    (clearNotes       || warrantyNotes.trim() !== "")
  );
  const validScope = !doScope || draftScopes.length > 0;
  const anythingChecked = doStatus || doWarranty || doScope;
  const canSubmit = anythingChecked && validWarranty && validScope;

  const mut = useMutation({
    mutationFn: () => {
      const body: BulkEditBody = { vendor_ids: vendors.map((v) => v.id) };
      if (doStatus) {
        body.active = { is_active: statusActive === "active" };
      }
      if (doWarranty) {
        body.warranty = {};
        if (clearLaborDays)         body.warranty.labor_warranty_days   = null;
        else if (laborDays.trim())  body.warranty.labor_warranty_days   = Number(laborDays);
        if (clearPartsDays)         body.warranty.parts_warranty_days   = null;
        else if (partsDays.trim())  body.warranty.parts_warranty_days   = Number(partsDays);
        if (clearPartsSource)       body.warranty.parts_warranty_source = null;
        else if (partsSource)       body.warranty.parts_warranty_source = partsSource;
        if (clearNotes)             body.warranty.warranty_notes        = null;
        else if (warrantyNotes.trim()) body.warranty.warranty_notes     = warrantyNotes.trim();
      }
      if (doScope) {
        body.scope = { scopes: draftScopes, mode: scopeMode };
      }
      return bulkEditVendors(body);
    },
    onSuccess: (r) => {
      setResults(r.results);
      const { updated = 0, failed = 0 } = r.summary;
      if (failed > 0) {
        onError(`${failed} vendor${failed === 1 ? "" : "s"} failed — see details below.`);
      } else {
        onSuccess(`Edited ${updated} vendor${updated === 1 ? "" : "s"}.`);
      }
    },
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Bulk edit failed."),
  });

  const showResults = results !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !mut.isPending) onClose(); }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            Edit {vendors.length} vendor{vendors.length === 1 ? "" : "s"}
          </div>
          <button
            type="button" onClick={onClose} disabled={mut.isPending}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {!showResults ? (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Applying to
                </div>
                <div className="mt-1 max-h-20 overflow-y-auto">
                  {vendors.map((v) => (
                    <span
                      key={v.id}
                      className="mr-1 mb-1 inline-block rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700"
                    >
                      {v.name}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-zinc-500">
                  Only checked sections below will be applied. Unchecked sections leave each vendor's existing values alone.
                </div>
              </div>

              {/* STATUS section */}
              <SectionToggle
                label="Status"
                checked={doStatus}
                onChange={setDoStatus}
              >
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["active", "inactive"] as const).map((v) => (
                    <label
                      key={v}
                      className={
                        "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs " +
                        (statusActive === v
                          ? "border-accent bg-accent/10 text-midnight"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-accent")
                      }
                    >
                      <input
                        type="radio" name="bulk-edit-status"
                        checked={statusActive === v}
                        onChange={() => setStatusActive(v)}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      Mark as {v}
                    </label>
                  ))}
                </div>
              </SectionToggle>

              {/* WARRANTY section */}
              <SectionToggle
                label="Warranty defaults"
                checked={doWarranty}
                onChange={setDoWarranty}
              >
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <BulkWarrantyField
                    label="Labor warranty (days)"
                    value={laborDays}
                    onChange={setLaborDays}
                    clear={clearLaborDays}
                    onClearChange={setClearLaborDays}
                  />
                  <BulkWarrantyField
                    label="Parts warranty (days)"
                    value={partsDays}
                    onChange={setPartsDays}
                    clear={clearPartsDays}
                    onClearChange={setClearPartsDays}
                  />
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-600">Parts warranty source</span>
                    <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <input
                        type="checkbox"
                        checked={clearPartsSource}
                        onChange={(e) => setClearPartsSource(e.target.checked)}
                        className="h-3 w-3 accent-accent"
                      />
                      Clear
                    </label>
                  </div>
                  <div className={"mt-1 flex flex-wrap gap-2 " + (clearPartsSource ? "opacity-50 pointer-events-none" : "")}>
                    {(["vendor", "manufacturer", "none"] as const).map((v) => (
                      <label
                        key={v}
                        className={
                          "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1 text-xs " +
                          (partsSource === v
                            ? "border-accent bg-accent/10 text-midnight"
                            : "border-zinc-200 bg-white text-zinc-700 hover:border-accent")
                        }
                      >
                        <input
                          type="radio" name="bulk-edit-parts-source"
                          checked={partsSource === v}
                          onChange={() => setPartsSource(v)}
                          className="h-3 w-3 accent-accent"
                        />
                        {v === "vendor" ? "Vendor-backed"
                          : v === "manufacturer" ? "Mfg pass-through"
                          : "None"}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-600">Warranty notes</span>
                    <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <input
                        type="checkbox"
                        checked={clearNotes}
                        onChange={(e) => setClearNotes(e.target.checked)}
                        className="h-3 w-3 accent-accent"
                      />
                      Clear
                    </label>
                  </div>
                  <Input
                    value={warrantyNotes}
                    onChange={(e) => setWarrantyNotes(e.target.value)}
                    placeholder="e.g. Excludes gaskets and seals. Must report failure within 48h."
                    disabled={clearNotes}
                    className={clearNotes ? "opacity-50" : ""}
                  />
                </div>
              </SectionToggle>

              {/* SCOPE section */}
              <SectionToggle
                label="Scope"
                checked={doScope}
                onChange={setDoScope}
              >
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(["add", "replace"] as const).map((m) => (
                      <label
                        key={m}
                        className={
                          "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs " +
                          (scopeMode === m
                            ? "border-accent bg-accent/10 text-midnight"
                            : "border-zinc-200 bg-white text-zinc-700 hover:border-accent")
                        }
                      >
                        <input
                          type="radio" name="bulk-edit-scope-mode"
                          checked={scopeMode === m}
                          onChange={() => setScopeMode(m)}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                        {m === "add" ? "Add to existing" : "Replace existing"}
                      </label>
                    ))}
                  </div>
                  <ScopeEditor
                    org={org}
                    scopes={draftScopes}
                    loading={false}
                    onChange={setDraftScopes}
                  />
                </div>
              </SectionToggle>

              {mut.isError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                  {(mut.error as Error).message}
                </div>
              )}
            </div>
            <div className="sticky bottom-0 z-10 flex flex-col-reverse items-stretch gap-2 border-t border-zinc-100 bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
              <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => mut.mutate()}
                disabled={mut.isPending || !canSubmit}
              >
                {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Apply to {vendors.length} vendor{vendors.length === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        ) : (
          <BulkEditResultsView
            results={results || []}
            vendors={vendors}
            onClose={onDone}
          />
        )}
      </div>
    </div>
  );
}

function SectionToggle({
  label, checked, onChange, children,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={"rounded-md border p-3 " + (checked ? "border-accent/40 bg-accent/5" : "border-zinc-200 bg-white")}>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        <span className="text-sm font-semibold tracking-tight text-midnight">
          {label}
        </span>
      </label>
      {checked && children}
    </div>
  );
}

function BulkWarrantyField({
  label, value, onChange, clear, onClearChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  clear: boolean;
  onClearChange: (c: boolean) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-600">{label}</span>
        <label className="flex items-center gap-1 text-[10px] text-zinc-500">
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => onClearChange(e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          Clear
        </label>
      </div>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={clear}
        className={clear ? "opacity-50" : ""}
        placeholder={clear ? "(will be cleared)" : "e.g. 90"}
      />
      <div className="mt-0.5 text-[10px] text-zinc-500">
        {clear ? "Will be set to empty for all selected." : daysHint(value)}
      </div>
    </div>
  );
}

function BulkEditResultsView({
  results, vendors, onClose,
}: {
  results: BulkEditResult[];
  vendors: Vendor[];
  onClose: () => void;
}) {
  const updated = results.filter((r) => r.status === "updated");
  const noop    = results.filter((r) => r.status === "noop");
  const failed  = results.filter((r) => r.status === "failed");
  const nameById = new Map(vendors.map((v) => [v.id, v.name]));

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          <ResultTile tone="success" count={updated.length} label="Updated" />
          <ResultTile tone="info"    count={noop.length}    label="No change" />
          <ResultTile tone="danger"  count={failed.length}  label="Failed" />
        </div>
        {failed.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-red-900">
              Failures
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-red-900">
              {failed.map((r) => (
                <li key={r.vendor_id}>
                  <span className="font-mono">{nameById.get(r.vendor_id) || r.vendor_id}</span>:{" "}
                  {r.message || "unknown error"}
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className="rounded-md border border-zinc-200 bg-white p-3 text-xs">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Full breakdown ({results.length})
          </summary>
          <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
            {results.map((r) => (
              <li key={r.vendor_id} className="flex items-center gap-2">
                {r.status === "updated" && <CheckCircle2 className="h-3 w-3 text-emerald-600" strokeWidth={2} />}
                {r.status === "noop"    && <span className="h-3 w-3 rounded-full bg-zinc-300" />}
                {r.status === "failed"  && <X className="h-3 w-3 text-red-600" strokeWidth={2} />}
                <span>{nameById.get(r.vendor_id) || r.vendor_id}</span>
                {r.actions && r.actions.length > 0 && (
                  <span className="text-zinc-500">— {r.actions.join(", ")}</span>
                )}
                {r.message && <span className="text-zinc-500">— {r.message}</span>}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-zinc-100 bg-white px-5 py-3">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}

// Predicate for the directory "Scope" filter. filter values follow
// the same shape used in the dropdown:
//   ""             → match anything
//   "none"         → vendor has zero scope rows
//   "national"     → vendor has a national row
//   "region:<id>"  → vendor has a region row with that id
//   "area:<id>"
//   "district:<id>"
function matchesScopeFilter(vendor: Vendor, filter: string): boolean {
  const scopes = vendor.vendor_scopes || [];
  if (!filter) return true;
  if (filter === "none") return scopes.length === 0;
  if (filter === "national") return scopes.some((s) => s.scope_type === "national");
  const idx = filter.indexOf(":");
  if (idx < 0) return false;
  const type = filter.slice(0, idx);
  const id = filter.slice(idx + 1);
  return scopes.some((s) => s.scope_type === type && s.scope_id === id);
}

