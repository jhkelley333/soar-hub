// Add / edit contact modal. The form shape depends on the caller's
// role: GMs can only create store-tier contacts for their own store;
// DO/SDO/RVP can create regional contacts for their region; admins
// can do anything. The server enforces the same rules.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import type { Contact, ContactKind, Tier } from "@/types/database";
import { createContact, deleteContact, updateContact, type ContactInput } from "./api";

const CONTACT_TYPES: { key: ContactKind; label: string }[] = [
  { key: "person", label: "Person" },
  { key: "vendor", label: "Vendor" },
  { key: "internal_team", label: "Internal team" },
  { key: "corporate", label: "Corporate" },
];

// Tiers the caller can create at, based on role. Mirrors the server.
function tiersForRole(role: string | undefined): Tier[] {
  if (!role) return [];
  if (["admin", "payroll", "vp", "coo"].includes(role)) {
    return ["company", "regional", "store"];
  }
  if (["do", "sdo", "rvp"].includes(role)) {
    return ["regional", "store"];
  }
  if (role === "gm") return ["store"];
  return [];
}

interface RegionRow { id: string; name: string | null; code: string | null; }
interface StoreRow { id: string; number: string; name: string | null; }

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

  const allowedTiers = useMemo(() => tiersForRole(profile?.role), [profile?.role]);

  const [displayName, setDisplayName] = useState("");
  const [contactType, setContactType] = useState<ContactKind>("person");
  const [phone, setPhone] = useState("");
  const [extension, setExtension] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [tier, setTier] = useState<Tier>("store");
  const [regionId, setRegionId] = useState<string>("");
  const [storeId, setStoreId] = useState<string>("");
  const [posFilter, setPosFilter] = useState<"" | "infor" | "micros">("");
  const [error, setError] = useState<string | null>(null);

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
      setStoreId(existing.store_id ?? "");
      setPosFilter(existing.pos_filter ?? "");
    } else {
      // New contact — default to the tightest scope the caller has.
      const t = allowedTiers[allowedTiers.length - 1] ?? "store";
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
      setStoreId(t === "store" ? (profile?.primary_store_id ?? "") : "");
      setPosFilter("");
    }
  }, [open, existing, allowedTiers, profile?.primary_store_id]);

  // Region + store options for the scope pickers. Read directly via
  // Supabase JS — RLS lets any signed-in user read org rows.
  const regionsQuery = useQuery({
    queryKey: ["org-regions-for-contacts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("regions")
        .select("id, name, code")
        .order("code");
      return (data ?? []) as RegionRow[];
    },
    enabled: open && tier === "regional",
    staleTime: 10 * 60_000,
  });

  const storesQuery = useQuery({
    queryKey: ["org-stores-for-contacts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("stores")
        .select("id, number, name")
        .eq("is_active", true)
        .order("number");
      return (data ?? []) as StoreRow[];
    },
    enabled: open && tier === "store",
    staleTime: 10 * 60_000,
  });

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
        region_id: tier === "regional" ? regionId : null,
        store_id: tier === "store" ? storeId : null,
        pos_filter: posFilter || null,
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
    if (tier === "regional" && !regionId) {
      setError("Pick a region.");
      return;
    }
    if (tier === "store" && !storeId) {
      setError("Pick a store.");
      return;
    }
    saveMut.mutate();
  }

  function onDelete() {
    if (!existing) return;
    if (!window.confirm(`Delete contact "${existing.display_name}"? This can't be undone.`)) return;
    deleteMut.mutate();
  }

  if (!open) return null;

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
              {allowedTiers.map((t) => (
                <option key={t} value={t}>
                  {t === "company" ? "Company" : t === "regional" ? "Regional" : "Store"}
                </option>
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

        {tier === "regional" && (
          <div>
            <Label htmlFor="c-region">Region *</Label>
            <select
              id="c-region"
              value={regionId}
              onChange={(e) => setRegionId(e.target.value)}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">— Select region —</option>
              {(regionsQuery.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {tier === "store" && (
          <div>
            <Label htmlFor="c-store">Store *</Label>
            <select
              id="c-store"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">— Select store —</option>
              {(storesQuery.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  Store #{s.number}
                  {s.name ? ` — ${s.name}` : ""}
                </option>
              ))}
            </select>
          </div>
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
