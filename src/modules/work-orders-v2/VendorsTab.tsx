// Vendors tab — list, search, add/edit, rate. The list call returns
// each vendor's avg rating + total ratings count, so we render a star
// row inline without a second fetch.
//
// Roles:
//   * Anyone can rate a vendor (1-5 stars + optional comment).
//   * DO+ can add / edit vendors (backend enforces).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Pencil, Phone, Plus, Star, X } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { fetchVendors, rateVendor, saveVendor } from "./api";
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
    queryFn: fetchVendors,
    staleTime: 60_000,
  });

  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [rating, setRating] = useState<Vendor | null>(null);

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
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            Add Vendor
          </Button>
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
