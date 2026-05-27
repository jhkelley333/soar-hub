// "Replacements" view in the WO2 admin (its own tab) and embedded
// on the My Stores store-detail page.
//
// Shows the UNION of:
//   * tickets.replacement_* rows (equipment ordered through the WO2
//     workflow via the Order Replacement action)
//   * equipment_register rows (manual entries — legacy backfill or
//     direct purchases made outside the workflow)
//
// Server normalizes both sources into a single row shape with a
// `source` discriminator. The Add Equipment button (DO+) opens the
// EquipmentEntryModal in insert mode; clicking the row's Edit icon
// opens the same modal seeded for update. Ticket-sourced rows are
// edited via the underlying ticket — clicking those rows navigates
// to the ticket.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Pencil, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchReplacements, type ReplacementRow, type ReplacementSource } from "./api";
import { statusLabel } from "./types";
import { EquipmentEntryModal } from "./EquipmentEntryModal";

// DO and above can add / edit manual equipment entries. Mirrors the
// VendorsTab canManage check.
const ROLE_LEVEL: Record<string, number> = {
  admin: 0, payroll: 1, coo: 2, vp: 2, rvp: 3, sdo: 3, do: 3,
  gm: 4, am: 4, employee: 5,
};
function canManageEquipment(role: string | null | undefined): boolean {
  if (!role) return false;
  return (ROLE_LEVEL[role.toLowerCase()] ?? 99) <= 3;
}

function addDays(iso: string | null, days: number | null): Date | null {
  if (!iso || days == null) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * 86400000);
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function WarrantyCell({
  installIso,
  days,
  label,
}: {
  installIso: string | null;
  days: number | null;
  label: string;
}) {
  if (days == null) return <span className="text-zinc-400">—</span>;
  const end = addDays(installIso, days);
  if (!end) {
    return (
      <span className="text-zinc-600">
        {days}d <span className="text-[10px] text-zinc-400">(no install date)</span>
      </span>
    );
  }
  const msLeft = end.getTime() - Date.now();
  const daysLeft = Math.floor(msLeft / 86400000);
  const tone =
    daysLeft < 0      ? "bg-red-50 text-red-800 border-red-200"
    : daysLeft <= 30  ? "bg-amber-50 text-amber-900 border-amber-200"
    : "bg-emerald-50 text-emerald-900 border-emerald-200";
  const note = daysLeft < 0 ? "expired" : `${daysLeft}d left`;
  return (
    <span className={cn("inline-flex flex-col rounded border px-1.5 py-0.5", tone)}>
      <span className="text-[10px] uppercase tracking-wide opacity-75">{label}</span>
      <span className="text-xs font-semibold">{fmtDate(end)}</span>
      <span className="text-[10px] opacity-75">{note}</span>
    </span>
  );
}

// Three labels per user's pick: workflow-sourced rows + the two
// manual flavors. Color-coded so the eye can scan the table quickly.
function SourceChip({ source }: { source: ReplacementSource }) {
  const { label, tone } = sourceMeta(source);
  return (
    <span className={cn("inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", tone)}>
      {label}
    </span>
  );
}
function sourceMeta(source: ReplacementSource): { label: string; tone: string } {
  switch (source) {
    case "wo2_ticket":    return { label: "From WO",     tone: "bg-accent/10 text-midnight" };
    case "manual_legacy": return { label: "Legacy",      tone: "bg-zinc-200 text-zinc-700" };
    case "manual_direct": return { label: "Direct",      tone: "bg-indigo-100 text-indigo-800" };
  }
}

type SortKey = "purchased" | "installed" | "store" | "model" | "cost" | "asset_tag";

interface Props {
  // Optional. Scope the API call AND the UI to a single store.
  // Used by the My Stores embed; admin tab leaves unset.
  storeNumber?: string;
  // Used together with storeNumber to lock the Add modal's store
  // picker. Pass both from the per-store embed.
  storeId?: string;
  hideStoreColumn?: boolean;
  compact?: boolean;
}

export function ReplacementsTab({ storeNumber, storeId, hideStoreColumn = false }: Props) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canManage = canManageEquipment(profile?.role);

  const [sortKey, setSortKey] = useState<SortKey>("installed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [storeFilter, setStoreFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<"" | ReplacementSource>("");
  const [q, setQ] = useState<string>("");

  // Edit-modal state. null = add (no seed); a row = edit that entry.
  const [modalRow, setModalRow] = useState<ReplacementRow | null | undefined>(undefined);

  const replacementsQ = useQuery({
    queryKey: ["wo2", "replacements", storeNumber || ""],
    queryFn: () => fetchReplacements({ storeNumber }),
    staleTime: 30_000,
  });

  const rows = replacementsQ.data?.replacements ?? [];

  const stores = useMemo(() => {
    if (storeNumber) return [];
    const set = new Map<string, string>();
    for (const r of rows) {
      const label = r.store_name ? `#${r.store_number} · ${r.store_name}` : `#${r.store_number}`;
      set.set(r.store_number, label);
    }
    return Array.from(set.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([number, label]) => ({ number, label }));
  }, [rows, storeNumber]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = rows;
    if (storeFilter)  out = out.filter((r) => r.store_number === storeFilter);
    if (sourceFilter) out = out.filter((r) => r.source === sourceFilter);
    if (ql) {
      out = out.filter((r) =>
        [r.wo_number, r.store_number, r.store_name, r.model,
         r.supplier, r.asset_tag, r.po_number, r.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(ql),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case "purchased": return dir * cmpStr(a.purchased_at, b.purchased_at);
        case "installed": return dir * cmpStr(a.installed_at, b.installed_at);
        case "store":     return dir * cmpStr(a.store_number, b.store_number);
        case "model":     return dir * cmpStr(a.model, b.model);
        case "cost":      return dir * cmpNum(a.cost, b.cost);
        case "asset_tag": return dir * cmpStr(a.asset_tag, b.asset_tag);
      }
    });
    return out;
  }, [rows, storeFilter, sourceFilter, q, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const isLoading = replacementsQ.isLoading;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search WO #, asset tag, model, supplier, notes…"
          className="h-9 flex-1 min-w-[200px] rounded-md border border-zinc-200 bg-white px-3 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
          className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm"
        >
          <option value="">All sources</option>
          <option value="wo2_ticket">From Work Order</option>
          <option value="manual_legacy">Legacy</option>
          <option value="manual_direct">Direct Purchase</option>
        </select>
        {stores.length > 1 && (
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm"
          >
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.number} value={s.number}>{s.label}</option>
            ))}
          </select>
        )}
        <div className="text-xs text-zinc-500">
          {filtered.length} of {rows.length}
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setModalRow(null)}>
            <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
            Add Equipment
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card>
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No equipment yet"
          description={
            canManage
              ? "Use the Order Replacement action on a ticket, or click Add Equipment above to record a legacy or direct purchase."
              : "Once equipment is recorded, it'll appear here."
          }
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <Th>Source</Th>
                  <Th>WO #</Th>
                  {!hideStoreColumn && <SortableTh active={sortKey === "store"} dir={sortDir} onClick={() => toggleSort("store")}>Store</SortableTh>}
                  <Th>Asset Type</Th>
                  <SortableTh active={sortKey === "model"} dir={sortDir} onClick={() => toggleSort("model")}>Manufacturer / Model</SortableTh>
                  <SortableTh active={sortKey === "installed"} dir={sortDir} onClick={() => toggleSort("installed")}>Installed</SortableTh>
                  <Th>Warranty</Th>
                  <Th>Status</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const clickable = r.source === "wo2_ticket" && r.ticket_id;
                  return (
                    <tr
                      key={r.equipment_id || r.ticket_id || `${r.store_number}-${r.asset_tag}-${r.model}`}
                      className={cn(
                        "border-b border-zinc-100",
                        clickable && "cursor-pointer hover:bg-zinc-50",
                      )}
                      onClick={() => {
                        if (clickable) navigate(`/admin/work-orders-v2?ticket=${r.ticket_id}`);
                      }}
                    >
                      <td className="px-3 py-2"><SourceChip source={r.source} /></td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-midnight">
                        {r.wo_number || <span className="text-zinc-400">—</span>}
                      </td>
                      {!hideStoreColumn && (
                        <td className="px-3 py-2">
                          <div className="text-sm font-semibold text-midnight">#{r.store_number}</div>
                          {r.store_name && <div className="text-[11px] text-zinc-500">{r.store_name}</div>}
                        </td>
                      )}
                      <td className="px-3 py-2 text-zinc-700">{r.asset_type || <span className="text-zinc-400">—</span>}</td>
                      <td className="px-3 py-2">
                        {r.manufacturer && (
                          <div className="font-medium text-midnight">{r.manufacturer}</div>
                        )}
                        <div className={r.manufacturer ? "text-xs text-zinc-600" : ""}>
                          {r.model || <span className="text-zinc-400">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-600">{fmtDate(r.installed_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <WarrantyCell installIso={r.installed_at} days={r.warranty_labor_days} label="Labor" />
                          <WarrantyCell installIso={r.installed_at} days={r.warranty_parts_days} label={`Parts${r.warranty_parts_source ? ` · ${r.warranty_parts_source}` : ""}`} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {r.status ? (
                          <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
                        ) : (
                          <span className="text-[11px] text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {r.receipt_url && (
                            <a
                              href={r.receipt_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                            >
                              <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                              Receipt
                            </a>
                          )}
                          {canManage && r.source !== "wo2_ticket" && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setModalRow(r); }}
                              className="text-zinc-400 hover:text-midnight"
                              aria-label="Edit equipment"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {modalRow !== undefined && (
        <EquipmentEntryModal
          open={true}
          existing={modalRow}
          storeIdLock={storeNumber ? (storeId || null) : null}
          storeNumberLock={storeNumber || null}
          onClose={() => setModalRow(undefined)}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-semibold">{children}</th>;
}

function SortableTh({
  children, active, dir, onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      className={cn("cursor-pointer px-3 py-2 font-semibold select-none", active && "text-midnight")}
      onClick={onClick}
    >
      {children}
      {active && <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

function cmpStr(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

function cmpNum(a: number | string | null, b: number | string | null): number {
  const na = a == null ? -Infinity : (typeof a === "string" ? Number(a) : a);
  const nb = b == null ? -Infinity : (typeof b === "string" ? Number(b) : b);
  if (!Number.isFinite(na) && !Number.isFinite(nb)) return 0;
  if (!Number.isFinite(na)) return 1;
  if (!Number.isFinite(nb)) return -1;
  return na - nb;
}

function statusTone(s: string): "info" | "warning" | "success" | "danger" | "neutral" {
  switch (s) {
    case "submitted":          return "info";
    case "in_progress":        return "warning";
    case "scheduled":          return "info";
    case "on_site":            return "warning";
    case "awaiting_equipment": return "warning";
    case "completed":          return "success";
    case "closed":             return "neutral";
    case "cancelled":          return "neutral";
    default:                   return "neutral";
  }
}
