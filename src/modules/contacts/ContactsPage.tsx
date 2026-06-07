// Contacts module — list page. Three-tier (company / regional / store)
// contact directory with pinned + category grouping + search +
// tier-filter pills + auto-filter by the user's store POS system, and a
// prominent "Make the Right Call" button feeding the escalation drawer.
//
// Top-level toggle (Contacts / Vendors): the Vendors view pulls live
// from /.netlify/functions/facilities-v2 (the Facilities V2 vendors
// table) and is read-only here — managed at /admin/work-orders-v2.

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, PhoneOutgoing, Pin, PinOff, Plus, Search, X } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Input } from "@/shared/ui/Input";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { formatPhoneForDisplay } from "@/lib/phone";
import { cn } from "@/lib/cn";
import type { Contact, Tier } from "@/types/database";
import {
  listContacts,
  pinContact,
  unpinContact,
} from "./api";
import { ContactDetailDrawer } from "./ContactDetailDrawer";
import { ContactEditModal } from "./ContactEditModal";
import { MakeTheRightCallDrawer } from "./MakeTheRightCallDrawer";
import { VendorsListSection } from "./VendorsListSection";

type TierFilter = "all" | Tier;
type ViewMode = "contacts" | "vendors";

const TIER_LABEL: Record<Tier, string> = {
  company: "Company",
  regional: "Regional",
  area: "Area",
  district: "District",
  store: "Store",
};

const TIER_TONE: Record<Tier, "info" | "warning" | "neutral" | "success"> = {
  company: "info",
  regional: "warning",
  area: "warning",
  district: "success",
  store: "neutral",
};

const EDITOR_ROLES = new Set(["admin", "payroll", "vp", "coo", "do", "sdo", "rvp", "gm"]);

function downloadContactsAsPDF(
  contacts: Contact[],
  userPos: string | null,
) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const ts = new Date().toLocaleString();
  doc.setFontSize(14);
  doc.text("SOAR Contacts", 40, 50);
  doc.setFontSize(9);
  doc.setTextColor(120);
  const subtitle = userPos
    ? `Filtered for ${userPos === "infor" ? "Infor" : "Micros"} POS · Exported ${ts}`
    : `Exported ${ts}`;
  doc.text(subtitle, 40, 66);
  doc.setTextColor(0);

  autoTable(doc, {
    head: [["Category", "Name", "Phone / Ext", "Email", "Tier", "Notes"]],
    body: contacts.map((c) => [
      c.category ?? "",
      c.display_name,
      [c.phone ?? "", c.extension ? `ext ${c.extension}` : ""].filter(Boolean).join("  "),
      c.email ?? "",
      TIER_LABEL[c.tier],
      c.notes ?? "",
    ]),
    startY: 80,
    styles: { fontSize: 8, cellPadding: 4, valign: "top" },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 110 },
      2: { cellWidth: 100 },
      3: { cellWidth: 110 },
      4: { cellWidth: 50 },
      5: { cellWidth: "auto" },
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  doc.save(`soar-contacts-${today}.pdf`);
}

export function ContactsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [view, setView] = useState<ViewMode>("contacts");
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [callDrawerOpen, setCallDrawerOpen] = useState(false);

  const canCreate = !!profile && EDITOR_ROLES.has(profile.role);
  const pinned = new Set(profile?.pinned_contact_ids ?? []);

  const contactsQuery = useQuery({
    queryKey: ["contacts-list"],
    queryFn: listContacts,
    staleTime: 60_000,
    enabled: view === "contacts",
  });

  const userPosQuery = useQuery({
    queryKey: ["user-store-pos", profile?.primary_store_id],
    queryFn: async () => {
      if (!profile?.primary_store_id) return { pos_system: null as null | string };
      const { data } = await supabase
        .from("stores")
        .select("pos_system")
        .eq("id", profile.primary_store_id)
        .maybeSingle();
      return { pos_system: (data?.pos_system as string | null) ?? null };
    },
    enabled: !!profile?.primary_store_id,
    staleTime: 5 * 60_000,
  });
  const userPos = userPosQuery.data?.pos_system ?? null;

  const allContacts = contactsQuery.data?.contacts ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allContacts.filter((c) => {
      if (tierFilter !== "all" && c.tier !== tierFilter) return false;
      if (userPos && c.pos_filter && c.pos_filter !== userPos) return false;
      if (q) {
        const hay = [c.display_name, c.phone, c.email, c.notes, c.category]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allContacts, search, tierFilter, userPos]);

  const pinnedContacts = useMemo(
    () => filtered.filter((c) => pinned.has(c.id)),
    [filtered, pinned]
  );

  const grouped = useMemo(() => {
    const rest = filtered.filter((c) => !pinned.has(c.id));
    const buckets = new Map<string, Contact[]>();
    for (const c of rest) {
      const cat = c.category?.trim() || "Other";
      if (!buckets.has(cat)) buckets.set(cat, []);
      buckets.get(cat)!.push(c);
    }
    const tierOrder: Record<Tier, number> = { company: 0, regional: 1, area: 2, district: 3, store: 4 };
    const out: { category: string; contacts: Contact[] }[] = [];
    for (const [category, list] of buckets) {
      list.sort((a, b) => {
        const t = tierOrder[a.tier] - tierOrder[b.tier];
        if (t !== 0) return t;
        return a.display_name.localeCompare(b.display_name);
      });
      out.push({ category, contacts: list });
    }
    out.sort((a, b) => a.category.localeCompare(b.category));
    return out;
  }, [filtered, pinned]);

  function togglePin(c: Contact) {
    const isPinned = pinned.has(c.id);
    const fn = isPinned ? unpinContact : pinContact;
    fn(c.id)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["auth-profile"] });
      })
      .catch((e: unknown) => {
        toast.push(e instanceof Error ? e.message : "Couldn't update pin.", "error");
      });
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description={
          view === "contacts"
            ? "Three-tier directory: company, regional, store."
            : "Vendor directory pulled from Facilities V2."
        }
        actions={
          view === "contacts" ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => setCallDrawerOpen(true)}>
                <PhoneOutgoing className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.75} />
                Make the Right Call
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadContactsAsPDF(filtered, userPos)}
                disabled={filtered.length === 0}
                title="Download the currently visible contacts as a PDF"
              >
                <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Download PDF
              </Button>
              {canCreate && (
                <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
                  <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                  Add contact
                </Button>
              )}
            </div>
          ) : null
        }
      />

      {/* View toggle */}
      <div className="mb-4 flex border-b border-zinc-200">
        {(["contacts", "vendors"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium tracking-tight transition",
              view === v
                ? "border-accent text-midnight"
                : "border-transparent text-zinc-500 hover:text-midnight",
            )}
          >
            {v === "contacts" ? "Contacts" : "Vendors"}
          </button>
        ))}
      </div>

      {view === "vendors" && <VendorsListSection />}

      {view === "contacts" && (
        <>
          <Card className="mb-4">
            <div className="space-y-3 p-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                  strokeWidth={1.75}
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, phone, email, category…"
                  className="pl-9 pr-9"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(["all", "company", "regional", "area", "district", "store"] as const).map((t) => (
                  <TierPill
                    key={t}
                    active={tierFilter === t}
                    onClick={() => setTierFilter(t)}
                    label={t === "all" ? "All" : TIER_LABEL[t]}
                  />
                ))}
                {userPos && (
                  <span className="ml-auto text-xs text-zinc-500">
                    Auto-filtered for{" "}
                    <span className="font-medium text-midnight">
                      {userPos === "infor" ? "Infor" : "Micros"}
                    </span>{" "}
                    POS
                  </span>
                )}
              </div>
            </div>
          </Card>

          {contactsQuery.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {contactsQuery.isError && (
            <EmptyState
              title="Couldn't load contacts"
              description={(contactsQuery.error as Error)?.message ?? "Try again."}
            />
          )}

          {contactsQuery.data && filtered.length === 0 && (
            <EmptyState
              title={search || tierFilter !== "all" ? "No matches" : "No contacts yet"}
              description={
                search || tierFilter !== "all"
                  ? "Adjust the filters or clear the search."
                  : canCreate
                    ? "Add your first contact to get started."
                    : "Your admin hasn't added any contacts yet."
              }
            />
          )}

          {contactsQuery.data && filtered.length > 0 && (
            <div className="space-y-5">
              {pinnedContacts.length > 0 && (
                <ContactGroup
                  category="📌 Pinned"
                  contacts={pinnedContacts}
                  pinned={pinned}
                  onTogglePin={togglePin}
                  onOpen={(c) => setOpenId(c.id)}
                />
              )}
              {grouped.map((g) => (
                <ContactGroup
                  key={g.category}
                  category={g.category}
                  contacts={g.contacts}
                  pinned={pinned}
                  onTogglePin={togglePin}
                  onOpen={(c) => setOpenId(c.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Drawers / modals */}
      <ContactDetailDrawer
        contactId={openId}
        onClose={() => setOpenId(null)}
        onEdit={(c) => {
          setOpenId(null);
          setEditing(c);
        }}
      />
      <ContactEditModal
        target={editing}
        onClose={() => setEditing(null)}
      />
      <MakeTheRightCallDrawer
        open={callDrawerOpen}
        onClose={() => setCallDrawerOpen(false)}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function TierPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-xs font-medium transition " +
        (active
          ? "bg-midnight text-white"
          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 hover:text-midnight")
      }
    >
      {label}
    </button>
  );
}

function ContactGroup({
  category,
  contacts,
  pinned,
  onTogglePin,
  onOpen,
}: {
  category: string;
  contacts: Contact[];
  pinned: Set<string>;
  onTogglePin: (c: Contact) => void;
  onOpen: (c: Contact) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {category} <span className="text-zinc-400">({contacts.length})</span>
      </div>
      <Card>
        <ul className="divide-y divide-zinc-100">
          {contacts.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              isPinned={pinned.has(c.id)}
              onTogglePin={() => onTogglePin(c)}
              onOpen={() => onOpen(c)}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ContactRow({
  contact,
  isPinned,
  onTogglePin,
  onOpen,
}: {
  contact: Contact;
  isPinned: boolean;
  onTogglePin: () => void;
  onOpen: () => void;
}) {
  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 text-left transition hover:opacity-80"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold uppercase text-zinc-500">
            {contact.display_name.trim().slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-midnight">
                {contact.display_name}
              </span>
              <Badge tone={TIER_TONE[contact.tier]}>{TIER_LABEL[contact.tier]}</Badge>
              {contact.pos_filter && (
                <Badge tone="neutral">
                  {contact.pos_filter === "infor" ? "Infor" : "Micros"}
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
              {contact.phone && <span>{formatPhoneForDisplay(contact.phone)}</span>}
              {contact.email && <span className="truncate">{contact.email}</span>}
              {contact.extension && <span>ext {contact.extension}</span>}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={isPinned ? "Unpin contact" : "Pin contact"}
          title={isPinned ? "Unpin" : "Pin"}
          className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-accent"
        >
          {isPinned ? (
            <PinOff className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <Pin className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </li>
  );
}
