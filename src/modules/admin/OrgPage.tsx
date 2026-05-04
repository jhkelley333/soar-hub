import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, MapPin, AlertCircle } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { ROLE_LABELS } from "@/types/database";
import { formatPhoneForDisplay } from "@/lib/phone";
import { cn } from "@/lib/cn";
import {
  fetchOrgTree,
  type OrgArea,
  type OrgDistrict,
  type OrgManager,
  type OrgRegion,
  type OrgStore,
} from "./api";

type ExpandedSet = Set<string>;

export function OrgPage() {
  const query = useQuery({
    queryKey: ["org-tree"],
    queryFn: fetchOrgTree,
  });

  // Track which nodes are expanded. Default: regions + areas open, districts closed.
  // Key format: "kind:id" so collisions across kinds are impossible.
  const [expanded, setExpanded] = useState<ExpandedSet>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");

  // Derive default-expanded keys once data lands.
  const defaultsApplied = useMemo(() => {
    if (!query.data) return false;
    const def = new Set<string>();
    for (const r of query.data.regions) {
      def.add(key("region", r.id));
      for (const a of r.areas) def.add(key("area", a.id));
    }
    if (expanded.size === 0) {
      setExpanded(def);
      return true;
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  function toggle(k: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }

  function expandAll() {
    if (!query.data) return;
    const all = new Set<string>();
    for (const r of query.data.regions) {
      all.add(key("region", r.id));
      for (const a of r.areas) {
        all.add(key("area", a.id));
        for (const d of a.districts) all.add(key("district", d.id));
      }
    }
    setExpanded(all);
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  // Filter the tree client-side. We hide stores that don't match the search,
  // then collapse upward — districts/areas/regions vanish only if every child
  // also disappeared. is_active filter is inclusive: an inactive store still
  // shows under its district unless showInactive is off.
  const filtered = useMemo(() => {
    if (!query.data) return null;
    const q = search.trim().toLowerCase();
    return filterTree(query.data.regions, q, showInactive);
  }, [query.data, search, showInactive]);

  // Auto-expand matched nodes when the user types — otherwise the search
  // result is buried inside collapsed parents.
  const effectiveExpanded = useMemo(() => {
    if (!search.trim() || !filtered) return expanded;
    const hits = new Set(expanded);
    for (const r of filtered) {
      hits.add(key("region", r.id));
      for (const a of r.areas) {
        hits.add(key("area", a.id));
        for (const d of a.districts) hits.add(key("district", d.id));
      }
    }
    return hits;
  }, [expanded, filtered, search]);

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="Org Admin" description="Hierarchy and assignments." />
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeader title="Org Admin" />
        <EmptyState
          title="Couldn't load the org tree"
          description={(query.error as Error)?.message ?? "Try again in a moment."}
        />
      </>
    );
  }

  const data = query.data!;
  // Reference defaultsApplied so it isn't flagged unused — the hook's job
  // is the side-effect of seeding `expanded` on first load.
  void defaultsApplied;

  return (
    <>
      <PageHeader
        title="Org Admin"
        description={
          <span>
            {data.stats.total_regions} region · {data.stats.total_areas} areas ·{" "}
            {data.stats.total_districts} districts · {data.stats.active_stores}/
            {data.stats.total_stores} active stores
            {data.stats.vacant_scopes > 0 && (
              <>
                {" · "}
                <span className="font-medium text-amber-700">
                  {data.stats.vacant_scopes} vacant
                </span>
              </>
            )}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={expandAll}
              className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 hover:text-midnight"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 hover:text-midnight"
            >
              Collapse
            </button>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:gap-3">
        <input
          type="search"
          placeholder="Search store, district, area, region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="block min-w-0 flex-1 rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Include inactive
        </label>
      </div>

      {!filtered || filtered.length === 0 ? (
        <EmptyState
          title={search ? "No matches" : "No org data yet"}
          description={
            search
              ? "Adjust the search or clear it to see the full tree."
              : "Run the seed migration to populate regions, areas, districts, and stores."
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <RegionRow
              key={r.id}
              region={r}
              expanded={effectiveExpanded}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Tree rows
// ----------------------------------------------------------------------------

function RegionRow({
  region,
  expanded,
  onToggle,
}: {
  region: OrgRegion;
  expanded: ExpandedSet;
  onToggle: (k: string) => void;
}) {
  const k = key("region", region.id);
  const isOpen = expanded.has(k);
  return (
    <Card className="overflow-hidden p-0">
      <NodeHeader
        depth={0}
        code={region.code}
        title={region.name}
        isActive={region.is_active}
        managers={region.managers}
        isOpen={isOpen}
        onToggle={() => onToggle(k)}
        kindLabel="Region"
      />
      {isOpen && (
        <div className="divide-y divide-zinc-100 border-t border-zinc-100 bg-zinc-50/30">
          {region.areas.map((a) => (
            <AreaRow
              key={a.id}
              area={a}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
          {region.areas.length === 0 && (
            <div className="px-4 py-3 pl-12 text-xs text-zinc-500">No areas.</div>
          )}
        </div>
      )}
    </Card>
  );
}

function AreaRow({
  area,
  expanded,
  onToggle,
}: {
  area: OrgArea;
  expanded: ExpandedSet;
  onToggle: (k: string) => void;
}) {
  const k = key("area", area.id);
  const isOpen = expanded.has(k);
  return (
    <div>
      <NodeHeader
        depth={1}
        code={area.code}
        title={area.name}
        isActive={area.is_active}
        managers={area.managers}
        isOpen={isOpen}
        onToggle={() => onToggle(k)}
        kindLabel="Area"
      />
      {isOpen && (
        <div className="divide-y divide-zinc-100 bg-white">
          {area.districts.map((d) => (
            <DistrictRow
              key={d.id}
              district={d}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
          {area.districts.length === 0 && (
            <div className="px-4 py-2 pl-16 text-xs text-zinc-500">No districts.</div>
          )}
        </div>
      )}
    </div>
  );
}

function DistrictRow({
  district,
  expanded,
  onToggle,
}: {
  district: OrgDistrict;
  expanded: ExpandedSet;
  onToggle: (k: string) => void;
}) {
  const k = key("district", district.id);
  const isOpen = expanded.has(k);
  return (
    <div>
      <NodeHeader
        depth={2}
        code={district.code}
        title={district.name}
        isActive={district.is_active}
        managers={district.managers}
        isOpen={isOpen}
        onToggle={() => onToggle(k)}
        kindLabel="District"
        countLabel={`${district.stores.length} ${district.stores.length === 1 ? "store" : "stores"}`}
      />
      {isOpen && (
        <div className="divide-y divide-zinc-100 bg-zinc-50/30">
          {district.stores.map((s) => (
            <StoreRow key={s.id} store={s} />
          ))}
          {district.stores.length === 0 && (
            <div className="px-4 py-2 pl-20 text-xs text-zinc-500">No stores.</div>
          )}
        </div>
      )}
    </div>
  );
}

function StoreRow({ store }: { store: OrgStore }) {
  return (
    <div className={cn("px-4 py-3 pl-20", !store.is_active && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-midnight">
          #{store.number}
        </span>
        <span className="text-sm text-zinc-700">{store.name}</span>
        {!store.is_active && <Badge tone="neutral">Inactive</Badge>}
        {store.managers.length === 0 && <Badge tone="warning">Vacant</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
        {(store.address || store.city) && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" strokeWidth={1.75} />
            {[store.address, store.city, store.state, store.zip]
              .filter(Boolean)
              .join(", ")}
          </span>
        )}
        {store.phone && <span>{formatPhoneForDisplay(store.phone)}</span>}
      </div>
      <ManagerChips managers={store.managers} />
    </div>
  );
}

function NodeHeader({
  depth,
  code,
  title,
  isActive,
  managers,
  isOpen,
  onToggle,
  kindLabel,
  countLabel,
}: {
  depth: 0 | 1 | 2;
  code: string;
  title: string;
  isActive: boolean;
  managers: OrgManager[];
  isOpen: boolean;
  onToggle: () => void;
  kindLabel: string;
  countLabel?: string;
}) {
  const indent = ["pl-4", "pl-12", "pl-16"][depth];
  const sizing =
    depth === 0
      ? "py-3 text-sm font-semibold"
      : depth === 1
        ? "py-2 text-sm font-medium"
        : "py-2 text-sm";
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 pr-4 text-left transition hover:bg-zinc-50",
        indent,
        sizing
      )}
    >
      <ChevronRight
        className={cn(
          "h-4 w-4 shrink-0 text-zinc-400 transition-transform",
          isOpen && "rotate-90"
        )}
        strokeWidth={2}
      />
      <span
        className={cn(
          "shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-zinc-600",
          !isActive && "opacity-60"
        )}
      >
        {code}
      </span>
      <span className={cn("truncate text-midnight", !isActive && "opacity-60")}>
        {title}
      </span>
      {!isActive && <Badge tone="neutral">Inactive</Badge>}
      {managers.length === 0 && (
        <span className="inline-flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5 text-amber-600" strokeWidth={2} />
          <span className="text-xs font-medium text-amber-700">Vacant</span>
        </span>
      )}
      <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
        {countLabel && <span>{countLabel}</span>}
        <span className="hidden sm:inline">{kindLabel}</span>
        {managers.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="text-zinc-400">·</span>
            <span className="font-medium text-zinc-700">
              {managers[0].full_name?.trim() || managers[0].email}
            </span>
            {managers.length > 1 && (
              <span className="text-zinc-400">+{managers.length - 1}</span>
            )}
          </span>
        )}
      </div>
    </button>
  );
}

function ManagerChips({ managers }: { managers: OrgManager[] }) {
  if (!managers.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {managers.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs"
          title={m.email}
        >
          <span className="font-medium text-zinc-700">
            {m.full_name?.trim() || m.email}
          </span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">{ROLE_LABELS[m.role] ?? m.role}</span>
        </span>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function key(kind: "region" | "area" | "district", id: string) {
  return `${kind}:${id}`;
}

function filterTree(
  regions: OrgRegion[],
  q: string,
  showInactive: boolean
): OrgRegion[] {
  const out: OrgRegion[] = [];
  for (const r of regions) {
    if (!showInactive && !r.is_active) continue;
    const areas: OrgArea[] = [];
    for (const a of r.areas) {
      if (!showInactive && !a.is_active) continue;
      const districts: OrgDistrict[] = [];
      for (const d of a.districts) {
        if (!showInactive && !d.is_active) continue;
        const stores = d.stores.filter((s) => {
          if (!showInactive && !s.is_active) return false;
          if (!q) return true;
          return matchesStore(s, q);
        });
        const districtMatches = !q || matchesDistrict(d, q) || stores.length > 0;
        if (districtMatches) {
          districts.push({
            ...d,
            stores: q && stores.length === 0 && matchesDistrict(d, q) ? d.stores : stores,
          });
        }
      }
      const areaMatches = !q || matchesArea(a, q) || districts.length > 0;
      if (areaMatches) {
        areas.push({
          ...a,
          districts:
            q && districts.length === 0 && matchesArea(a, q) ? a.districts : districts,
        });
      }
    }
    const regionMatches = !q || matchesRegion(r, q) || areas.length > 0;
    if (regionMatches) {
      out.push({
        ...r,
        areas: q && areas.length === 0 && matchesRegion(r, q) ? r.areas : areas,
      });
    }
  }
  return out;
}

function matchesStore(s: OrgStore, q: string): boolean {
  return [s.number, s.name, s.city, s.state, s.zip, s.phone, s.address]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}
function matchesDistrict(d: OrgDistrict, q: string): boolean {
  return [d.code, d.name].some((v) => v.toLowerCase().includes(q));
}
function matchesArea(a: OrgArea, q: string): boolean {
  return [a.code, a.name].some((v) => v.toLowerCase().includes(q));
}
function matchesRegion(r: OrgRegion, q: string): boolean {
  return [r.code, r.name].some((v) => v.toLowerCase().includes(q));
}
