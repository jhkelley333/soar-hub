// "Replacements" tab in the WO2 admin. Lists every ticket where new
// equipment was ordered (replacement_model IS NOT NULL), regardless
// of status. Scope-filtered server-side to the caller's accessible
// stores; admins see everything.
//
// Doubles as the V2 dress rehearsal of the future V3 Assets view.
// Once V3 ships, the migration is one INSERT...SELECT and this same
// page (or its successor) can read from `assets` directly.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardBody } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchReplacements } from "./api";
import { statusLabel } from "./types";

// Adds `days` to an ISO date string. Returns null if either input
// is missing or unparseable. Used to compute warranty end-dates from
// install_date (ticket.completed_at) + warranty_*_days.
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

function fmtMoney(v: number | string | null): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Warranty cell shows the END date (computed from install_date +
// days). Color-codes by remaining time: red if expired, amber if
// expiring within 30 days, neutral otherwise.
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
    // Have days but no install date yet — still useful to show the
    // raw duration so the user knows what they ordered.
    return (
      <span className="text-zinc-600">
        {days}d <span className="text-[10px] text-zinc-400">(no install date)</span>
      </span>
    );
  }
  const now = Date.now();
  const msLeft = end.getTime() - now;
  const daysLeft = Math.floor(msLeft / 86400000);
  const tone =
    daysLeft < 0      ? "bg-red-50 text-red-800 border-red-200"
    : daysLeft <= 30  ? "bg-amber-50 text-amber-900 border-amber-200"
    : "bg-emerald-50 text-emerald-900 border-emerald-200";
  const note =
    daysLeft < 0      ? "expired"
    : daysLeft <= 30  ? `${daysLeft}d left`
    : `${daysLeft}d left`;
  return (
    <span className={cn("inline-flex flex-col rounded border px-1.5 py-0.5", tone)}>
      <span className="text-[10px] uppercase tracking-wide opacity-75">{label}</span>
      <span className="text-xs font-semibold">{fmtDate(end)}</span>
      <span className="text-[10px] opacity-75">{note}</span>
    </span>
  );
}

type SortKey =
  | "ordered" | "installed" | "store" | "model" | "cost" | "asset_tag";

interface Props {
  // Optional. When set, scope the API call AND the UI to a single
  // store. Used by the My Stores embed; admin tab leaves it unset.
  storeNumber?: string;
  // Hide the "Store" column when we're already scoped to one store.
  hideStoreColumn?: boolean;
  // Compact mode drops some columns + uses tighter spacing for the
  // My Stores embed. Admin tab leaves it default.
  compact?: boolean;
}

export function ReplacementsTab({ storeNumber, hideStoreColumn = false, compact = false }: Props) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("ordered");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [storeFilter, setStoreFilter] = useState<string>("");
  const [q, setQ] = useState<string>("");

  const replacementsQ = useQuery({
    queryKey: ["wo2", "replacements", storeNumber || ""],
    queryFn: () => fetchReplacements({ storeNumber }),
    staleTime: 30_000,
  });

  const rows = replacementsQ.data?.replacements ?? [];

  // Distinct store list for the filter dropdown — derived from the
  // current result set so the user only sees stores with actual
  // replacement activity (no empty choices).
  const stores = useMemo(() => {
    if (storeNumber) return []; // single-store mode
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
    if (storeFilter) out = out.filter((r) => r.store_number === storeFilter);
    if (ql) {
      out = out.filter((r) =>
        [r.wo_number, r.store_number, r.store_name, r.replacement_model,
         r.replacement_supplier, r.replacement_asset_tag, r.replacement_po_number]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(ql),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case "ordered":   return dir * cmpStr(a.replacement_ordered_at, b.replacement_ordered_at);
        case "installed": return dir * cmpStr(a.completed_at, b.completed_at);
        case "store":     return dir * cmpStr(a.store_number, b.store_number);
        case "model":     return dir * cmpStr(a.replacement_model, b.replacement_model);
        case "cost":      return dir * cmpNum(a.replacement_cost, b.replacement_cost);
        case "asset_tag": return dir * cmpStr(a.replacement_asset_tag, b.replacement_asset_tag);
      }
    });
    return out;
  }, [rows, storeFilter, q, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  if (replacementsQ.isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-6 w-48" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardBody>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No replacements yet"
        description={
          storeNumber
            ? "This store hasn't ordered any replacement equipment."
            : "Once you use the “Order Replacement” action on a ticket, the equipment shows up here."
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search WO #, asset tag, model, supplier…"
          className="h-9 flex-1 min-w-[200px] rounded-md border border-zinc-200 bg-white px-3 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
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
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <Th>WO #</Th>
                {!hideStoreColumn && <SortableTh active={sortKey === "store"} dir={sortDir} onClick={() => toggleSort("store")}>Store</SortableTh>}
                <SortableTh active={sortKey === "asset_tag"} dir={sortDir} onClick={() => toggleSort("asset_tag")}>Asset Tag</SortableTh>
                <SortableTh active={sortKey === "model"} dir={sortDir} onClick={() => toggleSort("model")}>Model</SortableTh>
                {!compact && <Th>Supplier</Th>}
                {!compact && <Th>PO #</Th>}
                <SortableTh active={sortKey === "cost"} dir={sortDir} onClick={() => toggleSort("cost")}>Cost</SortableTh>
                <SortableTh active={sortKey === "ordered"} dir={sortDir} onClick={() => toggleSort("ordered")}>Ordered</SortableTh>
                <SortableTh active={sortKey === "installed"} dir={sortDir} onClick={() => toggleSort("installed")}>Installed</SortableTh>
                <Th>Warranty</Th>
                <Th>Status</Th>
                <Th><span className="sr-only">Receipt</span></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50"
                  onClick={() => navigate(`/admin/work-orders-v2?ticket=${r.id}`)}
                >
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-midnight">{r.wo_number}</td>
                  {!hideStoreColumn && (
                    <td className="px-3 py-2">
                      <div className="text-sm font-semibold text-midnight">#{r.store_number}</div>
                      {r.store_name && <div className="text-[11px] text-zinc-500">{r.store_name}</div>}
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-xs">{r.replacement_asset_tag || <span className="text-zinc-400">—</span>}</td>
                  <td className="px-3 py-2">{r.replacement_model || <span className="text-zinc-400">—</span>}</td>
                  {!compact && (
                    <td className="px-3 py-2 text-zinc-700">{r.replacement_supplier || <span className="text-zinc-400">—</span>}</td>
                  )}
                  {!compact && (
                    <td className="px-3 py-2 font-mono text-xs text-zinc-600">{r.replacement_po_number || <span className="text-zinc-400">—</span>}</td>
                  )}
                  <td className="px-3 py-2 text-sm font-semibold tabular-nums">{fmtMoney(r.replacement_cost)}</td>
                  <td className="px-3 py-2 text-xs text-zinc-600">{fmtDate(r.replacement_ordered_at)}</td>
                  <td className="px-3 py-2 text-xs text-zinc-600">{fmtDate(r.completed_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <WarrantyCell installIso={r.completed_at} days={r.replacement_warranty_labor_days} label="Labor" />
                      <WarrantyCell installIso={r.completed_at} days={r.replacement_warranty_parts_days} label={`Parts${r.replacement_warranty_parts_source ? ` · ${r.replacement_warranty_parts_source}` : ""}`} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {r.receipt_url ? (
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
                    ) : (
                      <span className="text-[11px] text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
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
