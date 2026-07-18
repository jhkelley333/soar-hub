import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ChevronRight,
  Download,
  MapPin,
  Pencil,
  Plus,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS } from "@/types/database";
import { downloadCSV, toCSV } from "@/lib/csv";
import { formatPhoneForDisplay } from "@/lib/phone";
import { cn } from "@/lib/cn";
import {
  fetchOrgTree,
  type OrgArea,
  type OrgDistrict,
  type OrgManager,
  type OrgRegion,
  type OrgStore,
  type OrgTreeResponse,
} from "./api";
import {
  AddOrgNodeModal,
  EditOrgNodeModal,
  type AddTarget,
  type EditTarget,
} from "./OrgNodeModals";

type ExpandedSet = Set<string>;

const EXPORT_HEADERS = [
  "kind",
  "code",
  "name",
  "number",
  "phone",
  "address",
  "city",
  "state",
  "zip",
  "parent_code",
  "is_active",
];

// Flatten the nested tree into a single CSV with a `kind` column, ordered
// region → area → district → store so the file is import-ready (parents
// before children). Inactive rows are still emitted; the importer will
// pass through is_active=false on update.
function exportTreeCsv(tree: OrgTreeResponse | null) {
  if (!tree) return;
  const rows: Record<string, unknown>[] = [];
  for (const r of tree.regions) {
    rows.push({
      kind: "region",
      code: r.code,
      name: r.name,
      number: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      parent_code: "",
      is_active: r.is_active ? "true" : "false",
    });
    for (const a of r.areas) {
      rows.push({
        kind: "area",
        code: a.code,
        name: a.name,
        number: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        zip: "",
        parent_code: r.code,
        is_active: a.is_active ? "true" : "false",
      });
      for (const d of a.districts) {
        rows.push({
          kind: "district",
          code: d.code,
          name: d.name,
          number: "",
          phone: "",
          address: "",
          city: "",
          state: "",
          zip: "",
          parent_code: a.code,
          is_active: d.is_active ? "true" : "false",
        });
        for (const s of d.stores) {
          rows.push({
            kind: "store",
            code: "",
            name: s.name,
            number: s.number,
            phone: s.phone ?? "",
            address: s.address ?? "",
            city: s.city ?? "",
            state: s.state ?? "",
            zip: s.zip ?? "",
            parent_code: d.code,
            is_active: s.is_active ? "true" : "false",
          });
        }
      }
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  downloadCSV(`org-tree-${date}.csv`, toCSV(EXPORT_HEADERS, rows));
}

// ---------------------------------------------------------------------------
// Full export — everything the org tree carries: structure + leaders/people at
// every level + all store operational fields. NOT import-ready (leaders and
// store extras aren't round-tripped by Bulk Org Import); this is for
// reporting / dropping into a spreadsheet.
// ---------------------------------------------------------------------------
const FULL_EXPORT_HEADERS = [
  "kind",
  "code",
  "name",
  "number",
  "parent_code",
  "is_active",
  // People — joined "Name <email> (Role)" for every leader on the node.
  "leaders",
  // Store contact / location
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  // Store operations / vendor
  "plate_iq_email",
  "soar_company_name",
  "acquisition_date",
  "pos_provider",
  "security_vendor",
  "security_vendor_phone",
  "food_vendor_name",
  // Active programs
  "has_apple_pay",
  "has_order_ahead",
  "has_outdoor_seating",
  "has_drive_thru",
  "has_clearance_bar",
  "drive_thru_lanes",
  "drive_thru_type",
  "public_restroom_count",
  // Stall data
  "patio_pop_menu_count",
  "patio_pop_stall_numbers",
  "order_ahead_stall_count",
  "order_ahead_stall_numbers",
  "stall_pop_menu_count",
  "has_trailer_stall",
  "trailer_stall_number",
  // Third-party delivery
  "third_party_delivery",
];

function leadersCell(managers: OrgManager[]): string {
  return managers
    .map((m) => {
      const role = ROLE_LABELS[m.role] ?? m.role;
      const name = m.full_name?.trim() || "(no name)";
      return `${name} <${m.email}> (${role})`;
    })
    .join("; ");
}

// Does any linked manager match the roster GM name? Punctuation-insensitive,
// first/last-based (so middle names / suffixes don't trip it). True when there's
// no roster name or no manager to compare — only an actual clash flags.
function rosterMatchesManager(store: OrgStore): boolean {
  if (!store.roster_gm || !store.managers.length) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const firstLast = (t: string[]) => (t.length >= 2 ? `${t[0]} ${t[t.length - 1]}` : t[0]);
  const roster = norm(store.roster_gm);
  return store.managers.some((m) => {
    const nm = norm(m.full_name || m.email || "");
    return !!nm && (nm === roster || firstLast(nm.split(" ")) === firstLast(roster.split(" ")));
  });
}

function bool(v: boolean): string {
  return v ? "true" : "false";
}

function storeFields(s: OrgStore): Record<string, unknown> {
  return {
    phone: s.phone ?? "",
    email: s.email ?? "",
    address: s.address ?? "",
    city: s.city ?? "",
    state: s.state ?? "",
    zip: s.zip ?? "",
    plate_iq_email: s.plate_iq_email ?? "",
    soar_company_name: s.soar_company_name ?? "",
    acquisition_date: s.acquisition_date ?? "",
    pos_provider: s.pos_provider ?? "",
    security_vendor: s.security_vendor ?? "",
    security_vendor_phone: s.security_vendor_phone ?? "",
    food_vendor_name: s.food_vendor_name ?? "",
    has_apple_pay: bool(s.has_apple_pay),
    has_order_ahead: bool(s.has_order_ahead),
    has_outdoor_seating: bool(s.has_outdoor_seating),
    has_drive_thru: bool(s.has_drive_thru),
    has_clearance_bar: bool(s.has_clearance_bar),
    drive_thru_lanes: s.drive_thru_lanes ?? "",
    drive_thru_type: s.drive_thru_type ?? "",
    public_restroom_count: s.public_restroom_count ?? "",
    patio_pop_menu_count: s.patio_pop_menu_count ?? "",
    patio_pop_stall_numbers: s.patio_pop_stall_numbers ?? "",
    order_ahead_stall_count: s.order_ahead_stall_count ?? "",
    order_ahead_stall_numbers: s.order_ahead_stall_numbers ?? "",
    stall_pop_menu_count: s.stall_pop_menu_count ?? "",
    has_trailer_stall: bool(s.has_trailer_stall),
    trailer_stall_number: s.trailer_stall_number ?? "",
    third_party_delivery: (s.third_party_delivery ?? []).join(", "),
  };
}

// Blank store-specific cells for non-store rows so columns line up.
const EMPTY_STORE_FIELDS: Record<string, unknown> = {
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  plate_iq_email: "",
  soar_company_name: "",
  acquisition_date: "",
  pos_provider: "",
  security_vendor: "",
  security_vendor_phone: "",
  food_vendor_name: "",
  has_apple_pay: "",
  has_order_ahead: "",
  has_outdoor_seating: "",
  has_drive_thru: "",
  has_clearance_bar: "",
  drive_thru_lanes: "",
  drive_thru_type: "",
  public_restroom_count: "",
  patio_pop_menu_count: "",
  patio_pop_stall_numbers: "",
  order_ahead_stall_count: "",
  order_ahead_stall_numbers: "",
  stall_pop_menu_count: "",
  has_trailer_stall: "",
  trailer_stall_number: "",
  third_party_delivery: "",
};

function exportFullCsv(tree: OrgTreeResponse | null) {
  if (!tree) return;
  const rows: Record<string, unknown>[] = [];
  for (const r of tree.regions) {
    rows.push({
      kind: "region",
      code: r.code,
      name: r.name,
      number: "",
      parent_code: "",
      is_active: bool(r.is_active),
      leaders: leadersCell(r.managers),
      ...EMPTY_STORE_FIELDS,
    });
    for (const a of r.areas) {
      rows.push({
        kind: "area",
        code: a.code,
        name: a.name,
        number: "",
        parent_code: r.code,
        is_active: bool(a.is_active),
        leaders: leadersCell(a.managers),
        ...EMPTY_STORE_FIELDS,
      });
      for (const d of a.districts) {
        rows.push({
          kind: "district",
          code: d.code,
          name: d.name,
          number: "",
          parent_code: a.code,
          is_active: bool(d.is_active),
          leaders: leadersCell(d.managers),
          ...EMPTY_STORE_FIELDS,
        });
        for (const s of d.stores) {
          rows.push({
            kind: "store",
            code: "",
            name: s.name,
            number: s.number,
            parent_code: d.code,
            is_active: bool(s.is_active),
            leaders: leadersCell(s.managers),
            ...storeFields(s),
          });
        }
      }
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  downloadCSV(`org-full-export-${date}.csv`, toCSV(FULL_EXPORT_HEADERS, rows));
}

export function OrgPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const query = useQuery({
    queryKey: ["org-tree"],
    queryFn: fetchOrgTree,
  });

  const [expanded, setExpanded] = useState<ExpandedSet>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");

  // Modal state
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
  const [addParentLabel, setAddParentLabel] = useState<string | undefined>();

  function openEdit(target: EditTarget) {
    setEditTarget(target);
  }
  function openAdd(target: AddTarget, parentLabel?: string) {
    setAddTarget(target);
    setAddParentLabel(parentLabel);
  }

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

  const filtered = useMemo(() => {
    if (!query.data) return null;
    const q = search.trim().toLowerCase();
    return filterTree(query.data.regions, q, showInactive);
  }, [query.data, search, showInactive]);

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
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => openAdd({ kind: "region" })}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
                  Add Region
                </Button>
                <Link to="/admin/bulk-org-import">
                  <Button variant="ghost" size="sm">
                    <Upload className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                    Bulk import…
                  </Button>
                </Link>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportTreeCsv(data)}
              disabled={!data || data.regions.length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Download CSV (import)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportFullCsv(data)}
              disabled={!data || data.regions.length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Full export
            </Button>
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

      <EditOrgNodeModal
        open={!!editTarget}
        target={editTarget}
        tree={data}
        onClose={() => setEditTarget(null)}
      />
      <AddOrgNodeModal
        open={!!addTarget}
        target={addTarget}
        parentLabel={addParentLabel}
        onClose={() => {
          setAddTarget(null);
          setAddParentLabel(undefined);
        }}
      />

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
              isAdmin={isAdmin}
              onEdit={openEdit}
              onAdd={openAdd}
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

interface RowCallbacks {
  isAdmin: boolean;
  onEdit: (target: EditTarget) => void;
  onAdd: (target: AddTarget, parentLabel?: string) => void;
}

function RegionRow({
  region,
  expanded,
  onToggle,
  isAdmin,
  onEdit,
  onAdd,
}: {
  region: OrgRegion;
  expanded: ExpandedSet;
  onToggle: (k: string) => void;
} & RowCallbacks) {
  const k = key("region", region.id);
  const isOpen = expanded.has(k);
  const parentLabel = `${region.code} — ${region.name}`;
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
        isAdmin={isAdmin}
        onEdit={() => onEdit({ kind: "region", node: region })}
      />
      {isOpen && (
        <div className="divide-y divide-zinc-100 border-t border-zinc-100 bg-zinc-50/30">
          {region.areas.map((a) => (
            <AreaRow
              key={a.id}
              area={a}
              regionId={region.id}
              expanded={expanded}
              onToggle={onToggle}
              isAdmin={isAdmin}
              onEdit={onEdit}
              onAdd={onAdd}
            />
          ))}
          {region.areas.length === 0 && (
            <div className="px-4 py-3 pl-12 text-xs text-zinc-500">No areas.</div>
          )}
          {isAdmin && (
            <div className="px-4 py-2 pl-12">
              <button
                type="button"
                onClick={() =>
                  onAdd({ kind: "area", region_id: region.id }, parentLabel)
                }
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 hover:text-midnight"
              >
                <Plus className="h-3 w-3" strokeWidth={2} /> Add Area
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AreaRow({
  area,
  regionId,
  expanded,
  onToggle,
  isAdmin,
  onEdit,
  onAdd,
}: {
  area: OrgArea;
  regionId: string;
  expanded: ExpandedSet;
  onToggle: (k: string) => void;
} & RowCallbacks) {
  const k = key("area", area.id);
  const isOpen = expanded.has(k);
  const parentLabel = `${area.code} — ${area.name}`;
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
        isAdmin={isAdmin}
        onEdit={() =>
          onEdit({ kind: "area", node: area, region_id: regionId })
        }
      />
      {isOpen && (
        <div className="divide-y divide-zinc-100 bg-white">
          {area.districts.map((d) => (
            <DistrictRow
              key={d.id}
              district={d}
              areaId={area.id}
              expanded={expanded}
              onToggle={onToggle}
              isAdmin={isAdmin}
              onEdit={onEdit}
              onAdd={onAdd}
            />
          ))}
          {area.districts.length === 0 && (
            <div className="px-4 py-2 pl-16 text-xs text-zinc-500">No districts.</div>
          )}
          {isAdmin && (
            <div className="px-4 py-2 pl-16">
              <button
                type="button"
                onClick={() =>
                  onAdd({ kind: "district", area_id: area.id }, parentLabel)
                }
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 hover:text-midnight"
              >
                <Plus className="h-3 w-3" strokeWidth={2} /> Add District
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DistrictRow({
  district,
  areaId,
  expanded,
  onToggle,
  isAdmin,
  onEdit,
  onAdd,
}: {
  district: OrgDistrict;
  areaId: string;
  expanded: ExpandedSet;
  onToggle: (k: string) => void;
} & RowCallbacks) {
  const k = key("district", district.id);
  const isOpen = expanded.has(k);
  const parentLabel = `${district.code} — ${district.name}`;
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
        isAdmin={isAdmin}
        onEdit={() =>
          onEdit({ kind: "district", node: district, area_id: areaId })
        }
      />
      {isOpen && (
        <div className="divide-y divide-zinc-100 bg-zinc-50/30">
          {district.stores.map((s) => (
            <StoreRow
              key={s.id}
              store={s}
              districtId={district.id}
              isAdmin={isAdmin}
              onEdit={onEdit}
            />
          ))}
          {district.stores.length === 0 && (
            <div className="px-4 py-2 pl-20 text-xs text-zinc-500">No stores.</div>
          )}
          {isAdmin && (
            <div className="px-4 py-2 pl-20">
              <button
                type="button"
                onClick={() =>
                  onAdd({ kind: "store", district_id: district.id }, parentLabel)
                }
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 hover:text-midnight"
              >
                <Plus className="h-3 w-3" strokeWidth={2} /> Add Store
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StoreRow({
  store,
  districtId,
  isAdmin,
  onEdit,
}: {
  store: OrgStore;
  districtId: string;
  isAdmin: boolean;
  onEdit: (target: EditTarget) => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-start gap-3 px-4 py-3 pl-20",
        !store.is_active && "opacity-60"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-midnight">
            #{store.number}
          </span>
          <span className="text-sm text-zinc-700">{store.name}</span>
          {!store.is_active && <Badge tone="neutral">Inactive</Badge>}
          {store.managers.length === 0 ? (
            store.roster_gm ? (
              <span className="inline-flex items-center gap-1.5">
                <Badge tone="warning">No account</Badge>
                <span className="text-sm italic text-zinc-500">{store.roster_gm}</span>
              </span>
            ) : (
              <Badge tone="warning">Vacant</Badge>
            )
          ) : (
            store.roster_gm && !rosterMatchesManager(store) && (
              <span title={`Roster: ${store.roster_gm}`}><Badge tone="danger">Name differs</Badge></span>
            )
          )}
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
      {isAdmin && (
        <button
          type="button"
          onClick={() =>
            onEdit({ kind: "store", node: store, district_id: districtId })
          }
          className="mt-1 shrink-0 rounded-md p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-midnight group-hover:opacity-100"
          aria-label="Edit store"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
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
  isAdmin,
  onEdit,
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
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const indent = ["pl-4", "pl-12", "pl-16"][depth];
  const sizing =
    depth === 0
      ? "py-3 text-sm font-semibold"
      : depth === 1
        ? "py-2 text-sm font-medium"
        : "py-2 text-sm";
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 pr-3 transition hover:bg-zinc-50",
        sizing
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex flex-1 items-center gap-2 text-left",
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
      {isAdmin && (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-md p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-midnight group-hover:opacity-100"
          aria-label={`Edit ${kindLabel}`}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function ManagerChips({ managers }: { managers: OrgManager[] }) {
  if (!managers.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {managers.map((m) => (
        <span
          key={m.id}
          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
            m.acting ? "bg-amber-50 ring-1 ring-amber-200" : "bg-zinc-100"
          }`}
          title={m.acting ? `${m.email} · acting coverage` : m.email}
        >
          <span className="font-medium text-zinc-700">
            {m.full_name?.trim() || m.email}
          </span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">{ROLE_LABELS[m.role] ?? m.role}</span>
          {m.acting && <span className="text-amber-600">· acting</span>}
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
