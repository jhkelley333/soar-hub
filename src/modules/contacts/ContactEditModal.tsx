// Add / edit contact modal. Tiers and scope options are driven by the
// server's scope-options endpoint, so each user sees only the tiers
// they can actually write at + the regions/areas/districts/stores
// inside their reach. Server re-enforces; this is hint-only UI.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import type { Contact, ContactKind, Tier } from "@/types/database";
import {
  createContact,
  deleteContact,
  fetchScopeOptions,
  updateContact,
  type ContactInput,
} from "./api";

const CONTACT_TYPES: { key: ContactKind; label: string }[] = [
  { key: "person", label: "Person" },
  { key: "vendor", label: "Vendor" },
  { key: "internal_team", label: "Internal team" },
  { key: "corporate", label: "Corporate" },
];

const TIER_LABEL: Record<Tier, string> = {
  company: "Company (all stores)",
  regional: "Regional (entire region)",
  area: "Area (entire area)",
  district: "District (all stores in district)",
  store: "Store (one store)",
};

const TIER_ORDER: Tier[] = ["company", "regional", "area", "district", "store"];

export function ContactEditModal({
  target,
  onClose,
}: {
  target: Contact | "new" | null;
  onClose: () => void;
}) {
  const open = target !== null;
  const isNew = target === "new";
  const existing = target && target !== "new" ? target : null;
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [displayName, setDisplayName] = useState("");
  const [contactType, setContactType] = useState<ContactKind>("person");
  const [phone, setPhone] = useState("");
  const [extension, setExtension] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [tier, setTier] = useState<Tier>("store");
  const [regionId, setRegionId]     = useState<string>("");
  const [areaId, setAreaId]         = useState<string>("");
  const [districtId, setDistrictId] = useState<string>("");
  const [storeId, setStoreId]       = useState<string>("");
  const [posFilter, setPosFilter] = useState<"" | "infor" | "micros">("");
  const [error, setError] = useState<string | null>(null);

  // Driven by the server: which tiers can this user write, and what
  // scope options are available under each tier. Solves the "admin
  // tier picker has no regions" issue — the server controls SELECT
  // visibility on regions/areas/districts/stores and returns exactly
  // what the caller can target.
  const scopeQuery = useQuery({
    queryKey: ["contacts-scope-options"],
    queryFn: fetchScopeOptions,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const allowedTiers: Tier[] = useMemo(() => {
    const set = new Set(scopeQuery.data?.writeable_tiers ?? []);
    return TIER_ORDER.filter((t) => set.has(t));
  }, [scopeQuery.data]);

  // Hydrate when opening for an existing contact or fresh.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (existing) {
      setDisplayName(existing.display_name);
      setContactType(existing.contact_type);
      setPhone(existing.phone ?? "");
      setExtension(existing.extension ?? "");
      setEmail(existing.email ?? "");
      setWebsite(existing.website ?? "");
      setCategory(existing.category ?? "");
      setNotes(existing.notes ?? "");
      setTier(existing.tier);
      setRegionId(existing.region_id ?? "");
      setAreaId(existing.area_id ?? "");
      setDistrictId(existing.district_id ?? "");
      setStoreId(existing.store_id ?? "");
      setPosFilter(existing.pos_filter ?? "");
    } else {
      // New contact — default to the narrowest tier the caller can
      // write (store), or fall back to whatever's allowed.
      const t = allowedTiers.includes("store")
        ? "store"
        : (allowedTiers[allowedTiers.length - 1] ?? "store");
      setDisplayName("");
      setContactType("person");
      setPhone("");
      setExtension("");
      setEmail("");
      setWebsite("");
      setCategory("");
      setNotes("");
      setTier(t);
      setRegionId("");
      setAreaId("");
      setDistrictId("");
      setStoreId(t === "store" ? (profile?.primary_store_id ?? "") : "");
      setPosFilter("");
    }
  }, [open, existing, allowedTiers, profile?.primary_store_id]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: ContactInput = {
        display_name: displayName.trim(),
        contact_type: contactType,
        phone: phone.trim() || null,
        extension: extension.trim() || null,
        email: email.trim() || null,
        website: website.trim() || null,
        category: category.trim() || null,
        notes: notes.trim() || null,
        tier,
        region_id:   tier === "regional" ? regionId   : null,
        area_id:     tier === "area"     ? areaId     : null,
        district_id: tier === "district" ? districtId : null,
        store_id:    tier === "store"    ? storeId    : null,
        pos_filter:  posFilter || null,
      };
      if (existing) return updateContact(existing.id, payload);
      return createContact(payload);
    },
    onSuccess: () => {
      toast.push("Contact saved.", "success");
      qc.invalidateQueries({ queryKey: ["contacts-list"] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Save failed."),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteContact(existing!.id),
    onSuccess: () => {
      toast.push("Contact deleted.", "success");
      qc.invalidateQueries({ queryKey: ["contacts-list"] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Delete failed."),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }
    if (tier === "regional" && !regionId)    return setError("Pick a region.");
    if (tier === "area"     && !areaId)      return setError("Pick an area.");
    if (tier === "district" && !districtId)  return setError("Pick a district.");
    if (tier === "store"    && !storeId)     return setError("Pick a store.");
    saveMut.mutate();
  }

  function onDelete() {
    if (!existing) return;
    if (!window.confirm(`Delete contact "${existing.display_name}"? This can't be undone.`)) return;
    deleteMut.mutate();
  }

  if (!open) return null;

  const scope = scopeQuery.data;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? `Edit ${existing.display_name}` : "Add contact"}
      maxWidth="max-w-2xl"
      footer={
        <>
          {existing && (
            <Button
              variant="danger"
              onClick={onDelete}
              disabled={saveMut.isPending || deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saveMut.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="c-name">Display name *</Label>
          <Input
            id="c-name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Jane Doe — IT Helpdesk"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="c-type">Type</Label>
            <select
              id="c-type"
              value={contactType}
              onChange={(e) => setContactType(e.target.value as ContactKind)}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {CONTACT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="c-category">Category</Label>
            <Input
              id="c-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. POS, HR, Maintenance"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="c-phone">Phone</Label>
            <Input
              id="c-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-1234"
            />
          </div>
          <div>
            <Label htmlFor="c-ext">Extension</Label>
            <Input
              id="c-ext"
              value={extension}
              onChange={(e) => setExtension(e.target.value)}
              placeholder="e.g. 12"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="c-email">Email</Label>
          <Input
            id="c-email"
            type="email"
            inputMode="email"
            autoCapitalize="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="c-website">Website</Label>
          <Input
            id="c-website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="e.g. support.example.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="c-tier">Tier *</Label>
            <select
              id="c-tier"
              value={tier}
              onChange={(e) => setTier(e.target.value as Tier)}
              disabled={!isNew && profile?.role !== "admin"}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
            >
              {allowedTiers.length === 0 && (
                <option value="">— Loading…</option>
              )}
              {allowedTiers.map((t) => (
                <option key={t} value={t}>{TIER_LABEL[t]}</option>
              ))}
            </select>
            {!isNew && profile?.role !== "admin" && (
              <p className="mt-1 text-[11px] text-zinc-500">
                Only admins can change a contact's tier.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="c-pos">POS filter (Tech contacts only)</Label>
            <select
              id="c-pos"
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value as "" | "infor" | "micros")}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">— Applies to all stores —</option>
              <option value="infor">Infor only</option>
              <option value="micros">Micros only</option>
            </select>
          </div>
        </div>

        {/* Scope pickers, one per tier */}
        {tier === "regional" && (
          <ScopePicker
            label="Region *"
            id="c-region"
            value={regionId}
            onChange={setRegionId}
            options={(scope?.regions ?? []).map((r) => ({
              value: r.id,
              label: `${r.code} — ${r.name ?? ""}`,
            }))}
            empty="No regions in your scope."
          />
        )}
        {tier === "area" && (
          <ScopePicker
            label="Area *"
            id="c-area"
            value={areaId}
            onChange={setAreaId}
            options={(scope?.areas ?? []).map((a) => ({
              value: a.id,
              label: `${a.code} — ${a.name ?? ""}`,
            }))}
            empty="No areas in your scope."
          />
        )}
        {tier === "district" && (
          <ScopePicker
            label="District *"
            id="c-district"
            value={districtId}
            onChange={setDistrictId}
            options={(scope?.districts ?? []).map((d) => ({
              value: d.id,
              label: `${d.code} — ${d.name ?? ""}`,
            }))}
            empty="No districts in your scope."
          />
        )}
        {tier === "store" && (
          <ScopePicker
            label="Store *"
            id="c-store"
            value={storeId}
            onChange={setStoreId}
            options={(scope?.stores ?? []).map((s) => ({
              value: s.id,
              label: `Store #${s.number}${s.name ? ` — ${s.name}` : ""}`,
            }))}
            empty="No stores in your scope."
          />
        )}

        <div>
          <Label htmlFor="c-notes">Notes</Label>
          <textarea
            id="c-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="Internal notes — visible to everyone who can see this contact."
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}

function ScopePicker({
  label,
  id,
  value,
  onChange,
  options,
  empty,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  empty: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {options.length === 0 ? (
        <p className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          {empty}
        </p>
      ) : (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">— Select —</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
