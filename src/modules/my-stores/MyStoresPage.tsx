// /my-stores — drill-down org navigation scoped by role.
//
// Hierarchy: Region (RVP) → Area (SDO) → District (DO) → Store → Team
// Member profile. Each level is a card grid; clicking navigates to the
// next level via in-page state (no router churn for performance). The
// store detail and team-member profile are full views, not modals —
// matches the existing pattern for module pages while a Drawer is used
// only for the team-member profile so the queue stays visible.
//
// Starting view by role (per spec):
//   rvp: list of SDOs (areas) in their region
//   sdo: list of DOs (districts) in their area
//   do : list of stores in their district
//   gm : direct redirect to their primary store detail
//   payroll / admin / vp / coo: list of regions

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Search, Users, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Input } from "@/shared/ui/Input";
import { Badge } from "@/shared/ui/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS } from "@/types/database";
import { cn } from "@/lib/cn";
import { fetchMyTree } from "./api";
import type {
  MyAreaNode,
  MyDistrictNode,
  MyRegionNode,
  MyStoreNode,
  MyStoreTeamMember,
  StoreLeadership,
} from "./types";
import { StoreDetail } from "./StoreDetail";
import { MemberProfileDrawer } from "./MemberProfileDrawer";

type View =
  | { kind: "regions" }
  | { kind: "areas"; region: MyRegionNode }
  | { kind: "districts"; region: MyRegionNode; area: MyAreaNode }
  | { kind: "stores"; region: MyRegionNode; area: MyAreaNode; district: MyDistrictNode }
  | { kind: "store"; storeId: string };

export function MyStoresPage() {
  const { profile } = useAuth();
  const [view, setView] = useState<View>({ kind: "regions" });
  const [activeMember, setActiveMember] = useState<MyStoreTeamMember | null>(null);
  const [search, setSearch] = useState("");

  const treeQuery = useQuery({
    queryKey: ["my-stores-tree"],
    queryFn: fetchMyTree,
    staleTime: 5 * 60_000,
  });

  // Auto-skip levels per role: GM lands on their store; DO on their
  // store list (single district); SDO on their district list; RVP on
  // their area list. Anyone with multi-region reach sees the regions
  // grid as the starting view.
  useEffect(() => {
    if (!treeQuery.data || !profile) return;
    const regions = treeQuery.data.regions;
    if (!regions.length) return;
    const role = profile.role;

    if (role === "gm" && profile.primary_store_id) {
      setView({ kind: "store", storeId: profile.primary_store_id });
      return;
    }
    if (role === "do" && regions.length === 1) {
      const r = regions[0];
      if (r.areas.length === 1 && r.areas[0].districts.length === 1) {
        setView({ kind: "stores", region: r, area: r.areas[0], district: r.areas[0].districts[0] });
        return;
      }
    }
    if (role === "sdo" && regions.length === 1 && regions[0].areas.length === 1) {
      setView({ kind: "districts", region: regions[0], area: regions[0].areas[0] });
      return;
    }
    if (role === "rvp" && regions.length === 1) {
      setView({ kind: "areas", region: regions[0] });
      return;
    }
  }, [treeQuery.data, profile]);

  const { regions, leadership } = treeQuery.data ?? { regions: [], leadership: {} };
  const allStoresFlat = useMemo(() => {
    const out: { store: MyStoreNode; region: MyRegionNode; area: MyAreaNode; district: MyDistrictNode }[] = [];
    for (const r of regions) {
      for (const a of r.areas) {
        for (const d of a.districts) {
          for (const s of d.stores) {
            out.push({ store: s, region: r, area: a, district: d });
          }
        }
      }
    }
    return out;
  }, [regions]);

  // Search across stores (number, name, city) and team members (name).
  // Restricted to caller's scope because the tree itself is scoped.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const stores = allStoresFlat.filter(({ store }) => {
      const hay = [store.number, store.name, store.city].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    const members: { member: MyStoreTeamMember; store: MyStoreNode }[] = [];
    for (const { store } of allStoresFlat) {
      for (const m of store.team_members) {
        const hay = [m.full_name, m.preferred_name, m.email].filter(Boolean).join(" ").toLowerCase();
        if (hay.includes(q)) members.push({ member: m, store });
      }
    }
    return { stores: stores.slice(0, 25), members: members.slice(0, 25) };
  }, [search, allStoresFlat]);

  const activeStore = useMemo(() => {
    if (view.kind !== "store") return null;
    return allStoresFlat.find(({ store }) => store.id === view.storeId) ?? null;
  }, [view, allStoresFlat]);

  if (treeQuery.isLoading) {
    return (
      <>
        <PageHeader title="My Stores" description="Loading…" />
        <Skeleton className="h-32 w-full" />
      </>
    );
  }
  if (treeQuery.isError) {
    return (
      <>
        <PageHeader title="My Stores" />
        <EmptyState
          title="Couldn't load org data"
          description={(treeQuery.error as Error)?.message ?? "Try again."}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My Stores"
        description="Drill into the org and surface team contacts."
      />

      <Card className="mb-4">
        <div className="p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              strokeWidth={1.75}
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stores, employees, or managers"
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
        </div>
      </Card>

      {searchResults ? (
        <SearchResults
          results={searchResults}
          allStoresFlat={allStoresFlat}
          onPickStore={(storeId) => {
            setSearch("");
            setView({ kind: "store", storeId });
          }}
          onPickMember={(member) => {
            setSearch("");
            setActiveMember(member);
          }}
        />
      ) : (
        <>
          <Breadcrumb view={view} onNavigate={setView} />
          {view.kind === "regions" && (
            <CardGrid
              empty="No regions in your scope."
              items={regions.map((r) => ({
                key: r.id,
                title: r.name ?? r.code ?? r.id,
                subtitle: regionStats(r),
                onClick: () => setView({ kind: "areas", region: r }),
              }))}
            />
          )}
          {view.kind === "areas" && (
            <CardGrid
              empty="No areas in this region."
              items={view.region.areas.map((a) => ({
                key: a.id,
                title: a.name ?? a.code ?? a.id,
                subtitle: areaStats(a),
                onClick: () => setView({ kind: "districts", region: view.region, area: a }),
              }))}
            />
          )}
          {view.kind === "districts" && (
            <CardGrid
              empty="No districts in this area."
              items={view.area.districts.map((d) => ({
                key: d.id,
                title: d.name ?? d.code ?? d.id,
                subtitle: districtStats(d),
                onClick: () =>
                  setView({
                    kind: "stores",
                    region: view.region,
                    area: view.area,
                    district: d,
                  }),
              }))}
            />
          )}
          {view.kind === "stores" && (
            <CardGrid
              empty="No stores in this district."
              items={view.district.stores.map((s) => ({
                key: s.id,
                title: `Store #${s.number}`,
                subtitle: storeSubtitle(s),
                onClick: () => setView({ kind: "store", storeId: s.id }),
              }))}
            />
          )}
          {view.kind === "store" && activeStore && (
            <StoreDetail
              store={activeStore.store}
              leadership={(leadership[activeStore.store.id] ?? null) as StoreLeadership | null}
              onBack={
                profile?.role === "gm" &&
                profile?.primary_store_id === activeStore.store.id
                  ? undefined
                  : () =>
                      setView({
                        kind: "stores",
                        region: activeStore.region,
                        area: activeStore.area,
                        district: activeStore.district,
                      })
              }
              onMemberClick={(m) => setActiveMember(m)}
            />
          )}
          {view.kind === "store" && !activeStore && (
            <EmptyState
              title="Store not found"
              description="It may be outside your scope."
            />
          )}
        </>
      )}

      <MemberProfileDrawer
        open={!!activeMember}
        member={activeMember}
        viewerRole={profile?.role}
        onClose={() => setActiveMember(null)}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function Breadcrumb({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  const crumbs: { label: string; onClick?: () => void }[] = [
    { label: "All regions", onClick: () => onNavigate({ kind: "regions" }) },
  ];
  if (view.kind === "areas" || view.kind === "districts" || view.kind === "stores") {
    crumbs.push({
      label: view.region.name ?? view.region.code ?? "Region",
      onClick:
        view.kind === "areas"
          ? undefined
          : () => onNavigate({ kind: "areas", region: view.region }),
    });
  }
  if (view.kind === "districts" || view.kind === "stores") {
    crumbs.push({
      label: view.area.name ?? view.area.code ?? "Area",
      onClick:
        view.kind === "districts"
          ? undefined
          : () => onNavigate({ kind: "districts", region: view.region, area: view.area }),
    });
  }
  if (view.kind === "stores") {
    crumbs.push({ label: view.district.name ?? view.district.code ?? "District" });
  }
  if (view.kind === "store") {
    crumbs.push({ label: "Store detail" });
  }

  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
      {crumbs.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-300" strokeWidth={2} />}
          {c.onClick ? (
            <button
              type="button"
              onClick={c.onClick}
              className="rounded px-1 transition hover:bg-zinc-100 hover:text-midnight"
            >
              {c.label}
            </button>
          ) : (
            <span className="px-1 font-medium text-midnight">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

interface CardGridItem {
  key: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}
function CardGrid({ items, empty }: { items: CardGridItem[]; empty: string }) {
  if (!items.length) {
    return (
      <Card>
        <EmptyState title={empty} />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onClick}
          className="group flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-left transition hover:border-accent/50 hover:bg-zinc-50"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent">
            <Building2 className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold tracking-tight text-midnight">
              {item.title}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 truncate">{item.subtitle}</div>
          </div>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-zinc-300 transition group-hover:text-accent"
            strokeWidth={2}
          />
        </button>
      ))}
    </div>
  );
}

function SearchResults({
  results,
  allStoresFlat,
  onPickStore,
  onPickMember,
}: {
  results: { stores: typeof allStoresFlat; members: { member: MyStoreTeamMember; store: MyStoreNode }[] };
  allStoresFlat: { store: MyStoreNode; region: MyRegionNode; area: MyAreaNode; district: MyDistrictNode }[];
  onPickStore: (id: string) => void;
  onPickMember: (m: MyStoreTeamMember) => void;
}) {
  if (!results.stores.length && !results.members.length) {
    return (
      <Card>
        <EmptyState title="No matches" description="Try a different search term." />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {results.stores.length > 0 && (
        <Card>
          <div className="border-b border-zinc-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Stores ({results.stores.length})
          </div>
          <ul className="divide-y divide-zinc-100">
            {results.stores.map(({ store }) => (
              <li key={store.id}>
                <button
                  type="button"
                  onClick={() => onPickStore(store.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-zinc-50"
                >
                  <div>
                    <div className="text-sm font-medium text-midnight">
                      Store #{store.number}
                      {store.name && <span className="ml-2 text-zinc-600">{store.name}</span>}
                    </div>
                    {(store.city || store.state) && (
                      <div className="text-xs text-zinc-500">
                        {[store.city, store.state].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-300" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {results.members.length > 0 && (
        <Card>
          <div className="border-b border-zinc-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            People ({results.members.length})
          </div>
          <ul className="divide-y divide-zinc-100">
            {results.members.map(({ member, store }) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => onPickMember(member)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-zinc-50"
                >
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-zinc-400" strokeWidth={1.75} />
                    <div>
                      <div className="text-sm font-medium text-midnight">
                        {member.preferred_name || member.full_name || member.email}
                      </div>
                      <div className="text-xs text-zinc-500">
                        Store #{store.number} · {ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] ?? member.role}
                      </div>
                    </div>
                  </div>
                  <Badge tone="info">{ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] ?? member.role}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Counts shown as the card subtitle on each level.
// ----------------------------------------------------------------------------
function regionStats(r: MyRegionNode): string {
  let stores = 0;
  let members = 0;
  for (const a of r.areas) {
    for (const d of a.districts) {
      for (const s of d.stores) {
        stores += 1;
        members += s.team_members.length;
      }
    }
  }
  return `${r.areas.length} area${plural(r.areas.length)} · ${stores} store${plural(stores)} · ${members} team member${plural(members)}`;
}
function areaStats(a: MyAreaNode): string {
  let stores = 0;
  let members = 0;
  for (const d of a.districts) {
    for (const s of d.stores) {
      stores += 1;
      members += s.team_members.length;
    }
  }
  return `${a.districts.length} district${plural(a.districts.length)} · ${stores} store${plural(stores)} · ${members} team member${plural(members)}`;
}
function districtStats(d: MyDistrictNode): string {
  let members = 0;
  for (const s of d.stores) members += s.team_members.length;
  return `${d.stores.length} store${plural(d.stores.length)} · ${members} team member${plural(members)}`;
}
function storeSubtitle(s: MyStoreNode): string {
  const loc = [s.city, s.state].filter(Boolean).join(", ");
  const team = `${s.team_members.length} team member${plural(s.team_members.length)}`;
  return loc ? `${loc} · ${team}` : team;
}
function plural(n: number): string {
  return n === 1 ? "" : "s";
}

// Silence unused-warning when CardGridItem appears unused due to layout
// (used inside the file).
export { type CardGridItem };
// Silence unused-import when cn is conditionally needed.
void cn;
