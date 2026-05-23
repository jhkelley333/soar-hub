// Directory — mobile-first contacts directory from the 2026 design
// import. Pinned "My team" / "My district" at the top (role-aware),
// then a segmented District / Region / Above-store control with a
// sectioned list underneath.
//
// Real data: org tree from fetchMyTree(), RLS-scoped to the caller.
// No placeholders. Inline phone + chat icons on each row open the
// device dialer / mailto so a DO can take action without entering
// the profile.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, MessageSquare, Phone, Filter } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { Avatar } from "@/shared/ui/Avatar";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  fetchDirectory,
  type DirectoryPerson,
} from "./api";

type Scope = "district" | "region" | "above";

export function DirectoryPage() {
  const { profile } = useAuth();
  const [scope, setScope] = useState<Scope>("district");
  const [query, setQuery] = useState("");

  const dq = useQuery({
    queryKey: ["directory", profile?.id],
    queryFn: () => fetchDirectory(profile?.role ?? null, profile?.id ?? null),
    staleTime: 60_000,
    enabled: !!profile,
  });

  const data = dq.data;
  const q = query.trim().toLowerCase();
  const search = useMemo(
    () => (xs: DirectoryPerson[]) => {
      if (!q) return xs;
      return xs.filter((p) =>
        (p.name + " " + p.subtitle + " " + (p.districtCode ?? ""))
          .toLowerCase()
          .includes(q),
      );
    },
    [q],
  );

  const sections = data
    ? scope === "district"
      ? groupByDistrict(search(data.district))
      : scope === "region"
      ? [{ label: "Region — District owners", people: search(data.region) }]
      : [{ label: "Above-store", people: search(data.aboveStore) }]
    : [];

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full">
      <AppHeader
        title="Contacts"
        subtitle={
          data
            ? `${data.totalCount} people · ${data.scopeLabel}`
            : "Loading…"
        }
        trailing={
          <button
            type="button"
            className="text-midnight-500 hover:text-midnight-800"
            aria-label="Filter contacts"
          >
            <Filter className="h-4 w-4" strokeWidth={2} />
          </button>
        }
      />

      {/* Search bar */}
      <div className="px-4 pt-3 pb-3 bg-white border-b border-midnight-100 sticky top-12 z-10">
        <div className="flex items-center gap-2 bg-midnight-50 ring-1 ring-midnight-100 rounded-lg px-3 h-9">
          <Search className="h-3.5 w-3.5 text-midnight-400" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, store, role…"
            className="flex-1 bg-transparent text-[13px] text-midnight-900 placeholder:text-midnight-400 outline-none"
          />
        </div>
      </div>

      {dq.isLoading && (
        <div className="p-4 space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}

      {dq.isError && (
        <div className="p-4">
          <EmptyState
            title="Couldn't load the directory"
            description={(dq.error as Error)?.message ?? "Try again."}
          />
        </div>
      )}

      {data && (
        <>
          {/* Pinned section — role-aware quick-access list */}
          <div className="px-4 pt-3 pb-1.5 flex items-baseline justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500">
              {data.pinned.title}
            </span>
            <span className="text-[10.5px] tabular-nums text-midnight-400">
              {data.pinned.people.length}
            </span>
          </div>
          {data.pinned.people.length > 0 ? (
            <div className="bg-surface ring-1 ring-midnight-100 mx-3 rounded-xl overflow-hidden divide-y divide-midnight-100 shadow-card">
              {search(data.pinned.people).map((p) => (
                <PersonRow key={p.id} person={p} />
              ))}
            </div>
          ) : (
            <div className="mx-3 px-4 py-4 bg-surface ring-1 ring-midnight-100 rounded-xl text-[12px] text-midnight-500">
              No pinned contacts. Your team will appear here.
            </div>
          )}

          {/* Scope tabs */}
          <div className="px-4 pt-4 pb-2">
            <Segmented<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { value: "district", label: "District" },
                { value: "region", label: "Region" },
                { value: "above", label: "Above-store" },
              ]}
            />
          </div>

          {/* Scope sections */}
          <div className="space-y-3 pb-12">
            {sections.map((sec) => (
              <DirectorySection key={sec.label} label={sec.label} people={sec.people} />
            ))}
            {sections.every((s) => s.people.length === 0) && (
              <p className="px-6 pt-6 text-center text-[12px] text-midnight-500">
                {q ? "No matches for that search." : "No one in this scope yet."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Section + Row
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
        <span className="text-[10.5px] tabular-nums text-midnight-400">{people.length}</span>
      </div>
      <div className="bg-surface ring-1 ring-midnight-100 mx-3 rounded-xl overflow-hidden divide-y divide-midnight-100">
        {people.map((p) => (
          <PersonRow key={p.id} person={p} dense />
        ))}
      </div>
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
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-medium text-midnight-900 truncate">
            {person.name || person.email}
          </span>
        </div>
        <div className="text-[11.5px] text-midnight-500 truncate">{person.subtitle}</div>
      </div>
      <div className="flex items-center gap-1 text-midnight-400 shrink-0">
        <a
          href={`mailto:${person.email}`}
          className={cn(
            "p-1.5 rounded-md hover:bg-midnight-100 hover:text-midnight-700 transition",
          )}
          aria-label={`Email ${person.name}`}
          title={`Email ${person.email}`}
        >
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
        </a>
        {person.phone ? (
          <a
            href={`tel:${person.phone}`}
            className="p-1.5 rounded-md hover:bg-midnight-100 hover:text-midnight-700 transition"
            aria-label={`Call ${person.name}`}
            title={`Call ${person.phone}`}
          >
            <Phone className="h-3.5 w-3.5" strokeWidth={2} />
          </a>
        ) : (
          <span className="p-1.5 opacity-40" title="No phone on file">
            <Phone className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Group GMs by district so the District tab reads as a list of
// district sections rather than one long undifferentiated list. The
// design groups under "DISTRICT 14B · 8 GMs"; we render one section
// per distinct districtCode.
// ----------------------------------------------------------------------------

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
