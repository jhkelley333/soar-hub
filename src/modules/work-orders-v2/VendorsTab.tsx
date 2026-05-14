// Vendors tab — list, search, add/edit, rate. The list call returns
// each vendor's avg rating + total ratings count, so we render a star
// row inline without a second fetch.
//
// Roles:
//   * Anyone can rate a vendor (1-5 stars + optional comment).
//   * DO+ can add / edit vendors (backend enforces).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Layers, Loader2, Mail, Pencil, Phone, Plus, Star, X } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import {
  bulkImportVendors,
  fetchVendors,
  rateVendor,
  saveVendor,
  type BulkVendorResult,
  type BulkVendorRow,
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

  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [rating, setRating] = useState<Vendor | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

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
      if (!q) return true;
      return [v.name, v.category, v.service_area, v.services, v.phone, v.email, v.contact_person, v.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [vendors, search, area]);

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
        {canManage(callerRole) && (
          <>
            {callerRole === "admin" && (
              <Button variant="ghost" onClick={() => setBulkOpen(true)}>
                <Layers className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Bulk import
              </Button>
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

      <div className="space-y-3">
        {filtered.map((v) => (
          <VendorRow
            key={v.id}
            vendor={v}
            canManage={canManage(callerRole)}
            onEdit={() => setEditing(v)}
            onRate={() => setRating(v)}
          />
        ))}
      </div>

      {editing !== null && (
        <VendorEditModal
          vendor={editing === "new" ? null : editing}
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
  canManage,
  onEdit,
  onRate,
}: {
  vendor: Vendor;
  canManage: boolean;
  onEdit: () => void;
  onRate: () => void;
}) {
  const services = (vendor.services || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
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
  onClose,
  onSaved,
  onError,
}: {
  vendor: Vendor | null;
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

  const mut = useMutation({
    mutationFn: () => {
      if (!name.trim()) return Promise.reject(new Error("Vendor name is required."));
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
      };
      if (vendor) payload.id = vendor.id;
      return saveVendor(payload);
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
] as const;

type ImportField = typeof RECOGNIZED_FIELDS[number];

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
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                <div className="font-semibold text-midnight">How to format</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>
                    First row = header. Recognized columns:{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">
                      name, category, services, service_area, contact_person,
                      email, phone, notes, website, is_active, scope
                    </code>
                  </li>
                  <li>
                    Paste from a spreadsheet (tab-separated) or use commas —
                    we auto-detect.
                  </li>
                  <li>
                    <strong>scope</strong> column accepts:{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">national</code>,{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">district:Edmond,Norman</code>,{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">store:1242,1245</code>,
                    or combinations separated by{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[10px]">|</code>.
                  </li>
                  <li>
                    Rows match existing vendors by <strong>name</strong> (unique).
                    Matches are <strong>updated</strong>, new names become new vendors.
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
