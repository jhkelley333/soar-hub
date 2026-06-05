// Walkthrough review — submissions queue (the DO's inbox of submitted walks).
// Desktop browser: search, tier + district filters, CSV export, table view.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, Flag, Search } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchMyTree } from "@/modules/my-stores/api";
import { listReviewQueue, type ReviewFilters, type ReviewQueueRow } from "./api";
import { ScoreBadge, StatusChip } from "./tierUi";
import type { Tier } from "../types";

const STATUS_FILTERS: { id: NonNullable<ReviewFilters["status"]>; label: string }[] = [
  { id: "submitted", label: "Needs review" },
  { id: "needs_revision", label: "Returned" },
  { id: "approved", label: "Approved" },
  { id: "all", label: "All" },
];
const TIER_FILTERS: { id: Tier | "all"; label: string }[] = [
  { id: "all", label: "All tiers" },
  { id: "green", label: "Green" },
  { id: "yellow", label: "Yellow" },
  { id: "red", label: "Red" },
];

function relTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function exportCsv(rows: ReviewQueueRow[], districtFor: (id: string) => string) {
  const head = ["Store", "Store name", "District", "GM", "Score", "Tier", "Flags", "Template", "Status", "Submitted"];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.storeNumber, r.storeName, districtFor(r.storeId), r.submitterName, r.score, r.tier, r.flagCount, `v${r.templateVersion}`, r.status, r.submittedAt ?? ""]
      .map(esc)
      .join(","),
  );
  const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `walkthroughs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function SubmissionsTab() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ReviewFilters["status"]>("submitted");
  const [tier, setTier] = useState<Tier | "all">("all");
  const [district, setDistrict] = useState("all");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["wt-review-queue", status],
    queryFn: () => listReviewQueue({ status }),
  });
  // Store → district map for the district filter + CSV (cached org tree).
  const tree = useQuery({ queryKey: ["my-stores-tree"], queryFn: fetchMyTree, staleTime: 5 * 60_000 });

  const districtByStore = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of tree.data?.regions ?? []) {
      for (const a of r.areas ?? []) {
        for (const d of a.districts ?? []) {
          const label = d.name || d.code || "—";
          for (const s of d.stores ?? []) map.set(s.id, label);
        }
      }
    }
    return map;
  }, [tree.data]);
  const districts = useMemo(
    () => [...new Set([...districtByStore.values()])].sort(),
    [districtByStore],
  );
  const districtFor = (id: string) => districtByStore.get(id) ?? "—";

  const rows = query.data ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier !== "all" && r.tier !== tier) return false;
      if (district !== "all" && districtFor(r.storeId) !== district) return false;
      if (needle) {
        const hay = `${r.storeNumber} ${r.storeName} ${r.submitterName}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, tier, district, search, districtByStore]);

  return (
    <div className="space-y-4">
      {/* Status chips + count */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <Chip key={f.id} active={status === f.id} onClick={() => setStatus(f.id)}>{f.label}</Chip>
        ))}
        <span className="ml-auto text-xs text-zinc-400">{filtered.length} result{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {/* Toolbar: search · tier · district · export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-52 flex-1 items-center gap-2 rounded-lg ring-1 ring-inset ring-zinc-200 bg-white px-3">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search store, GM…"
            className="h-full flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="flex gap-1">
          {TIER_FILTERS.map((t) => (
            <Chip key={t.id} active={tier === t.id} onClick={() => setTier(t.id)}>{t.label}</Chip>
          ))}
        </div>
        {districts.length > 1 && (
          <select
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="h-8 rounded-full ring-1 ring-inset ring-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 outline-none"
          >
            <option value="all">All districts</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <button
          type="button"
          onClick={() => exportCsv(filtered, districtFor)}
          disabled={!filtered.length}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : query.error ? (
        <Card><CardBody className="text-sm text-red-600">{query.error instanceof Error ? query.error.message : "Failed to load."}</CardBody></Card>
      ) : !filtered.length ? (
        <EmptyState title="Nothing here" description="No walkthroughs match these filters." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="hidden grid-cols-[1.6fr_1.4fr_70px_70px_90px_110px_120px] gap-3 border-b border-zinc-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 lg:grid">
            <span>Store</span><span>GM</span><span>Score</span><span>Flags</span><span>Template</span><span>Submitted</span><span>Status</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {filtered.map((row) => (
              <Row key={row.id} row={row} onOpen={() => navigate(`/walkthrough-review/s/${row.id}`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition",
        active ? "bg-midnight text-white ring-midnight" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50",
      )}
    >
      {children}
    </button>
  );
}

function Row({ row, onOpen }: { row: ReviewQueueRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-1 gap-1 px-4 py-3 text-left hover:bg-zinc-50 lg:grid-cols-[1.6fr_1.4fr_70px_70px_90px_110px_120px] lg:items-center lg:gap-3"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-midnight">Store #{row.storeNumber}</div>
        <div className="truncate text-[11px] text-zinc-400">{row.storeName}</div>
      </div>
      <div className="truncate text-sm text-zinc-600">{row.submitterName}</div>
      <div><ScoreBadge score={row.score} tier={row.tier} /></div>
      <div className="text-sm">
        {row.flagCount > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-red-600">
            <Flag className="h-3 w-3" strokeWidth={2} />{row.flagCount}
          </span>
        ) : (
          <span className="text-zinc-300">0</span>
        )}
      </div>
      <div className="font-mono text-xs text-zinc-500">v{row.templateVersion}</div>
      <div className="text-xs text-zinc-500">{relTime(row.submittedAt)}</div>
      <div className="flex items-center gap-2">
        <StatusChip status={row.status} />
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-zinc-300 lg:ml-0" />
      </div>
    </button>
  );
}
