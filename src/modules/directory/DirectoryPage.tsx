// Directory — mobile-first contacts page. Four sources in one place:
//
//   - Team   : org-tree people (GMs, DOs, SDOs, RVPs in caller's reach)
//   - Hub    : admin-curated shared contacts (company / regional /
//              store tiers) from the existing contacts module
//   - Vendors: WO2 vendor catalog scoped to the caller
//   - Mine   : per-user private contacts (new in 0073) with full CRUD
//
// One sticky search bar at the top filters every tab. The tab labels
// carry live match counts so a user typing a name can see which source
// it lives in. Mine adds a "+ New" affordance and inline edit/delete
// from each row.

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  MessageSquare,
  Phone,
  Plus,
  Pencil,
  Trash2,
  StickyNote,
} from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { Avatar } from "@/shared/ui/Avatar";
import { Button } from "@/shared/ui/Button";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  fetchDirectory,
  type DirectoryPerson,
  type DirectoryHubContact,
  type DirectoryVendor,
} from "./api";
import {
  listPersonalContacts,
  deletePersonalContact,
  type PersonalContact,
} from "./personalContactsApi";
import { AddPersonalContactSheet } from "./AddPersonalContactSheet";

type Tab = "team" | "hub" | "vendors" | "mine";
type TeamScope = "district" | "region" | "above";

function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  if (!query) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

export function DirectoryPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("team");
  const [teamScope, setTeamScope] = useState<TeamScope>("district");
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<PersonalContact | null>(null);

  const directoryQ = useQuery({
    queryKey: ["directory", profile?.id],
    queryFn: () => fetchDirectory(profile?.role ?? null, profile?.id ?? null),
    staleTime: 60_000,
    enabled: !!profile,
  });

  const mineQ = useQuery({
    queryKey: ["personal-contacts", profile?.id],
    queryFn: () => listPersonalContacts().then((r) => r.contacts),
    staleTime: 30_000,
    enabled: !!profile,
  });

  const data = directoryQ.data;
  const mine = mineQ.data ?? [];

  const q = query.trim().toLowerCase();

  // Pre-filter every source by the global search so tab counts show
  // matches across all four. Tabs render their own filtered slice
  // without re-doing the work.
  const filteredTeam = useMemo<DirectoryPerson[]>(() => {
    if (!data) return [];
    const all = [...data.district, ...data.region, ...data.aboveStore];
    return all.filter((p) => matches(q, p.name, p.email, p.subtitle, p.districtCode));
  }, [data, q]);

  const filteredHub = useMemo<DirectoryHubContact[]>(() => {
    if (!data) return [];
    return data.hub.filter((c) => matches(q, c.name, c.email, c.subtitle, c.category));
  }, [data, q]);

  const filteredVendors = useMemo<DirectoryVendor[]>(() => {
    if (!data) return [];
    return data.vendors.filter((v) =>
      matches(q, v.name, v.email, v.subtitle, v.category),
    );
  }, [data, q]);

  const filteredMine = useMemo<PersonalContact[]>(
    () => mine.filter((c) => matches(q, c.name, c.email, c.phone, c.category, c.notes)),
    [mine, q],
  );

  // Counts shown on each tab — reflect the global search.
  const counts: Record<Tab, number> = {
    team: filteredTeam.length,
    hub: filteredHub.length,
    vendors: filteredVendors.length,
    mine: filteredMine.length,
  };

  const invalidateMine = useCallback(
    () => qc.invalidateQueries({ queryKey: ["personal-contacts", profile?.id] }),
    [qc, profile?.id],
  );

  async function handleDelete(c: PersonalContact) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    try {
      await deletePersonalContact(c.id);
      invalidateMine();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete contact.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full">
      <AppHeader
        title="Directory"
        subtitle={
          data
            ? `${data.totalCount + mine.length} entries · ${data.scopeLabel}`
            : "Loading…"
        }
      />

      {/* Global search — filters every tab at once. */}
      <div className="px-4 pt-3 pb-3 bg-white border-b border-midnight-100 sticky top-12 z-10">
        <div className="flex items-center gap-2 bg-midnight-50 ring-1 ring-midnight-100 rounded-lg px-3 h-9">
          <Search className="h-3.5 w-3.5 text-midnight-400" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search team, contacts, vendors, mine…"
            className="flex-1 bg-transparent text-[13px] text-midnight-900 placeholder:text-midnight-400 outline-none"
          />
        </div>
      </div>

      {/* Source tabs with live match counts so a user can tell which
          source their search hit even before switching. */}
      <div className="px-3 pt-3 pb-2 bg-surface-muted">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          dense
          options={[
            { value: "team", label: "Team", count: counts.team },
            { value: "hub", label: "Hub", count: counts.hub },
            { value: "vendors", label: "Vendors", count: counts.vendors },
            { value: "mine", label: "Mine", count: counts.mine },
          ]}
        />
      </div>

      {directoryQ.isLoading && (
        <div className="p-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}

      {directoryQ.isError && (
        <div className="p-4">
          <EmptyState
            title="Couldn't load the directory"
            description={(directoryQ.error as Error)?.message ?? "Try again."}
          />
        </div>
      )}

      {data && (
        <>
          {tab === "team" && (
            <TeamTab
              data={data}
              scope={teamScope}
              setScope={setTeamScope}
              filtered={filteredTeam}
              hasQuery={!!q}
            />
          )}

          {tab === "hub" && (
            <SimpleList
              empty={
                q
                  ? "No hub contacts match that search."
                  : "No shared contacts in your scope yet."
              }
              items={filteredHub}
              renderRow={(c) => <HubContactRow key={c.id} contact={c} />}
            />
          )}

          {tab === "vendors" && (
            <SimpleList
              empty={
                q
                  ? "No vendors match that search."
                  : "No vendors in your scope yet."
              }
              items={filteredVendors}
              renderRow={(v) => <VendorRow key={v.id} vendor={v} />}
            />
          )}

          {tab === "mine" && (
            <MineTab
              loading={mineQ.isLoading}
              errored={mineQ.isError}
              contacts={filteredMine}
              hasAny={mine.length > 0}
              hasQuery={!!q}
              onAdd={() => {
                setEditing(null);
                setSheetOpen(true);
              }}
              onEdit={(c) => {
                setEditing(c);
                setSheetOpen(true);
              }}
              onDelete={handleDelete}
            />
          )}
        </>
      )}

      <AddPersonalContactSheet
        open={sheetOpen}
        editing={editing}
        onClose={() => {
          setSheetOpen(false);
          setEditing(null);
        }}
        onSaved={() => invalidateMine()}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Team tab — pinned + scope sub-segment (existing behavior, scoped down
// to honor the global search). When the user is searching we collapse
// the pinned section + scope tabs and show a single flat result list so
// matches don't hide inside a folded sub-section.
// ----------------------------------------------------------------------------

function TeamTab({
  data,
  scope,
  setScope,
  filtered,
  hasQuery,
}: {
  data: NonNullable<ReturnType<typeof useDirData>>;
  scope: TeamScope;
  setScope: (s: TeamScope) => void;
  filtered: DirectoryPerson[];
  hasQuery: boolean;
}) {
  if (hasQuery) {
    return (
      <div className="pb-12 pt-2">
        <SectionHeader label={`Matches · ${filtered.length}`} />
        {filtered.length === 0 ? (
          <p className="px-6 pt-6 text-center text-[12px] text-midnight-500">
            No team members match that search.
          </p>
        ) : (
          <Card>
            {filtered.map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </Card>
        )}
      </div>
    );
  }

  const sections =
    scope === "district"
      ? groupByDistrict(data.district)
      : scope === "region"
      ? [{ label: "Region — District owners", people: data.region }]
      : [{ label: "Above-store", people: data.aboveStore }];

  return (
    <>
      <div className="px-4 pt-3 pb-1.5 flex items-baseline justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500">
          {data.pinned.title}
        </span>
        <span className="text-[10.5px] tabular-nums text-midnight-400">
          {data.pinned.people.length}
        </span>
      </div>
      {data.pinned.people.length > 0 ? (
        <Card>
          {data.pinned.people.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
        </Card>
      ) : (
        <div className="mx-3 px-4 py-4 bg-surface ring-1 ring-midnight-100 rounded-xl text-[12px] text-midnight-500">
          No pinned contacts. Your team will appear here.
        </div>
      )}

      <div className="px-4 pt-4 pb-2">
        <Segmented<TeamScope>
          value={scope}
          onChange={setScope}
          options={[
            { value: "district", label: "District" },
            { value: "region", label: "Region" },
            { value: "above", label: "Above-store" },
          ]}
        />
      </div>

      <div className="space-y-3 pb-12">
        {sections.map((sec) => (
          <DirectorySection key={sec.label} label={sec.label} people={sec.people} />
        ))}
        {sections.every((s) => s.people.length === 0) && (
          <p className="px-6 pt-6 text-center text-[12px] text-midnight-500">
            No one in this scope yet.
          </p>
        )}
      </div>
    </>
  );
}

// useDirData is just here to give TypeScript the inferred shape for
// TeamTab's `data` prop without importing DirectoryData explicitly.
function useDirData() {
  return null as unknown as ReturnType<typeof fetchDirectory> extends Promise<infer T>
    ? T
    : never;
}

// ----------------------------------------------------------------------------
// Mine tab — personal contacts with add/edit/delete.
// ----------------------------------------------------------------------------

function MineTab({
  loading,
  errored,
  contacts,
  hasAny,
  hasQuery,
  onAdd,
  onEdit,
  onDelete,
}: {
  loading: boolean;
  errored: boolean;
  contacts: PersonalContact[];
  hasAny: boolean;
  hasQuery: boolean;
  onAdd: () => void;
  onEdit: (c: PersonalContact) => void;
  onDelete: (c: PersonalContact) => void;
}) {
  return (
    <div className="pb-12 pt-1">
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500">
          My contacts
        </span>
        <Button size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2.25} /> New
        </Button>
      </div>

      {loading && (
        <div className="px-3 space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {errored && (
        <div className="px-4">
          <EmptyState
            title="Couldn't load your contacts"
            description="Try again in a moment."
          />
        </div>
      )}

      {!loading && !errored && contacts.length === 0 && (
        <div className="mx-3 px-4 py-6 bg-surface ring-1 ring-midnight-100 rounded-xl text-center">
          <p className="text-[13px] text-midnight-700 font-medium">
            {hasQuery
              ? "No matches in your contacts."
              : hasAny
              ? "No contacts."
              : "Your private contact list."}
          </p>
          <p className="mt-1 text-[11.5px] text-midnight-500">
            {hasQuery
              ? "Try a different search."
              : "Add vendors, contractors, or anyone you talk to outside the org tree."}
          </p>
          {!hasQuery && !hasAny && (
            <Button className="mt-3" size="sm" onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} /> Add your first contact
            </Button>
          )}
        </div>
      )}

      {!loading && !errored && contacts.length > 0 && (
        <Card>
          {contacts.map((c) => (
            <PersonalRow
              key={c.id}
              contact={c}
              onEdit={() => onEdit(c)}
              onDelete={() => onDelete(c)}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared row layout helpers
// ----------------------------------------------------------------------------

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface ring-1 ring-midnight-100 mx-3 rounded-xl overflow-hidden divide-y divide-midnight-100 shadow-card">
      {children}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1.5 flex items-baseline justify-between">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500">
        {label}
      </span>
    </div>
  );
}

function SimpleList<T>({
  items,
  renderRow,
  empty,
}: {
  items: T[];
  renderRow: (item: T) => React.ReactNode;
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <p className="px-6 pt-6 text-center text-[12px] text-midnight-500 pb-12">
        {empty}
      </p>
    );
  }
  return (
    <div className="pt-2 pb-12">
      <Card>{items.map(renderRow)}</Card>
    </div>
  );
}

function ActionLinks({
  email,
  phone,
  name,
}: {
  email: string | null;
  phone: string | null;
  name: string;
}) {
  return (
    <div className="flex items-center gap-1 text-midnight-400 shrink-0">
      {email ? (
        <a
          href={`mailto:${email}`}
          className="p-1.5 rounded-md hover:bg-midnight-100 hover:text-midnight-700 transition"
          aria-label={`Email ${name}`}
          title={`Email ${email}`}
        >
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
        </a>
      ) : (
        <span className="p-1.5 opacity-40" title="No email on file">
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      )}
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="p-1.5 rounded-md hover:bg-midnight-100 hover:text-midnight-700 transition"
          aria-label={`Call ${name}`}
          title={`Call ${phone}`}
        >
          <Phone className="h-3.5 w-3.5" strokeWidth={2} />
        </a>
      ) : (
        <span className="p-1.5 opacity-40" title="No phone on file">
          <Phone className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      )}
    </div>
  );
}

function PersonRow({
  person,
  dense = false,
}: {
  person: DirectoryPerson;
  dense?: boolean;
}) {
  const avatarSize = dense ? 32 : 36;
  return (
    <div className="w-full flex items-center gap-3 px-4 py-2.5">
      <Avatar name={`${person.role} ${person.name}`} size={avatarSize} />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-midnight-900 truncate">
          {person.name || person.email}
        </div>
        <div className="text-[11.5px] text-midnight-500 truncate">{person.subtitle}</div>
      </div>
      <ActionLinks email={person.email} phone={person.phone} name={person.name} />
    </div>
  );
}

function HubContactRow({ contact }: { contact: DirectoryHubContact }) {
  return (
    <div className="w-full flex items-center gap-3 px-4 py-2.5">
      <Avatar name={contact.name} size={32} />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-midnight-900 truncate">
          {contact.name}
        </div>
        <div className="text-[11.5px] text-midnight-500 truncate">
          {contact.subtitle || TIER_LABELS[contact.tier]}
        </div>
      </div>
      <ActionLinks email={contact.email} phone={contact.phone} name={contact.name} />
    </div>
  );
}

function VendorRow({ vendor }: { vendor: DirectoryVendor }) {
  return (
    <div className="w-full flex items-center gap-3 px-4 py-2.5">
      <Avatar name={vendor.name} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-medium text-midnight-900 truncate">
            {vendor.name}
          </span>
          {vendor.isInternal && (
            <span className="text-[9.5px] uppercase tracking-wider font-semibold text-accent">
              Internal
            </span>
          )}
        </div>
        <div className="text-[11.5px] text-midnight-500 truncate">
          {vendor.subtitle || "Vendor"}
        </div>
      </div>
      <ActionLinks email={vendor.email} phone={vendor.phone} name={vendor.name} />
    </div>
  );
}

function PersonalRow({
  contact,
  onEdit,
  onDelete,
}: {
  contact: PersonalContact;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="w-full px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Avatar name={contact.name} size={32} />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium text-midnight-900 truncate">
            {contact.name}
          </div>
          <div className="text-[11.5px] text-midnight-500 truncate">
            {contact.category || "Personal"}
          </div>
        </div>
        <ActionLinks email={contact.email} phone={contact.phone} name={contact.name} />
      </div>
      {contact.notes && (
        <div className="mt-1.5 ml-11 flex items-start gap-1.5 text-[11.5px] text-midnight-500">
          <StickyNote className="h-3 w-3 mt-0.5 shrink-0" strokeWidth={2} />
          <span className="line-clamp-2">{contact.notes}</span>
        </div>
      )}
      <div className="mt-1.5 ml-11 flex items-center gap-2 text-[11px] text-midnight-400">
        <button
          type="button"
          onClick={onEdit}
          className={cn(
            "inline-flex items-center gap-1 hover:text-midnight-700 transition",
          )}
        >
          <Pencil className="h-3 w-3" strokeWidth={2} /> Edit
        </button>
        <span className="text-midnight-200">·</span>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 hover:text-cherry transition"
        >
          <Trash2 className="h-3 w-3" strokeWidth={2} /> Delete
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Team scope grouping (existing behavior preserved).
// ----------------------------------------------------------------------------

function DirectorySection({
  label,
  people,
}: {
  label: string;
  people: DirectoryPerson[];
}) {
  if (people.length === 0) return null;
  return (
    <div>
      <div className="px-4 pt-3 pb-1.5 flex items-baseline justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500">
          {label}
        </span>
        <span className="text-[10.5px] tabular-nums text-midnight-400">
          {people.length}
        </span>
      </div>
      <Card>
        {people.map((p) => (
          <PersonRow key={p.id} person={p} dense />
        ))}
      </Card>
    </div>
  );
}

function groupByDistrict(
  people: DirectoryPerson[],
): { label: string; people: DirectoryPerson[] }[] {
  const buckets = new Map<string, DirectoryPerson[]>();
  for (const p of people) {
    const key = p.districtCode || "Other";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, ppl]) => ({
      label:
        code === "Other"
          ? `Other · ${ppl.length} GM${ppl.length === 1 ? "" : "s"}`
          : `District ${code} · ${ppl.length} GM${ppl.length === 1 ? "" : "s"}`,
      people: ppl,
    }));
}

// Tier label fallback for hub contacts when subtitle is empty.
const TIER_LABELS: Record<DirectoryHubContact["tier"], string> = {
  company: "Company",
  regional: "Regional",
  area: "Area",
  district: "District",
  store: "Store",
};
