// Walkthrough review — corrective actions. Desktop dashboard: stat cards,
// search + priority filter, List / Board views. Rows expand inline to show
// origin photos, advance status, and log resolution notes.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LayoutGrid, List as ListIcon, Search } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  getCapaPhotos,
  listCorrectiveActions,
  updateCorrectiveAction,
  type CapaRow,
  type CapaStatus,
} from "./api";
import { PriorityChip, StatusChip } from "./tierUi";

// Allowed forward transitions per current status.
const NEXT: Record<CapaStatus, { to: CapaStatus; label: string }[]> = {
  open: [{ to: "in_progress", label: "Start" }],
  in_progress: [{ to: "verified", label: "Mark verified" }],
  verified: [{ to: "closed", label: "Close" }, { to: "in_progress", label: "Reopen" }],
  closed: [{ to: "in_progress", label: "Reopen" }],
};

function isOverdue(ca: CapaRow): boolean {
  return !!ca.dueAt && new Date(ca.dueAt) < new Date() && ca.status !== "closed";
}
function overdueLabel(dueAt: string): string {
  const days = Math.floor((Date.now() - new Date(dueAt).getTime()) / 86_400_000);
  return days <= 0 ? "Today" : `Overdue ${days}d`;
}

type StatKey = "open" | "overdue" | "in_progress" | "verified";
type PriorityFilter = "all" | "high" | "med" | "low";

export function CorrectiveActionsTab() {
  // Pull everything in scope once; stats + filters are computed client-side.
  const query = useQuery({
    queryKey: ["wt-capa", "all"],
    queryFn: () => listCorrectiveActions({ status: "all" }),
  });
  const rows = query.data ?? [];

  const [stat, setStat] = useState<StatKey | null>(null);
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "board">("list");

  const counts = useMemo(() => {
    let open = 0, overdue = 0, inProgress = 0, verified = 0;
    for (const ca of rows) {
      if (ca.status === "open") open++;
      if (ca.status === "in_progress") inProgress++;
      if (ca.status === "verified") verified++;
      if (isOverdue(ca)) overdue++;
    }
    return { open, overdue, in_progress: inProgress, verified };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((ca) => {
      if (priority !== "all" && ca.priority !== priority) return false;
      if (stat === "overdue" ? !isOverdue(ca) : stat && ca.status !== stat) return false;
      if (!stat && ca.status === "closed") return false; // hide closed by default
      if (needle) {
        const hay = `${ca.title} ${ca.storeNumber} ${ca.storeName} ${ca.ownerName} ${ca.sourceItemCode}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, priority, stat, search]);

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={counts.open} tone="info" active={stat === "open"} onClick={() => setStat((s) => (s === "open" ? null : "open"))} />
        <StatCard label="Overdue" value={counts.overdue} tone="danger" active={stat === "overdue"} onClick={() => setStat((s) => (s === "overdue" ? null : "overdue"))} />
        <StatCard label="In progress" value={counts.in_progress} tone="warning" active={stat === "in_progress"} onClick={() => setStat((s) => (s === "in_progress" ? null : "in_progress"))} />
        <StatCard label="Awaiting DO" value={counts.verified} tone="success" active={stat === "verified"} onClick={() => setStat((s) => (s === "verified" ? null : "verified"))} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-lg ring-1 ring-inset ring-zinc-200 bg-white px-3">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, store, owner…"
            className="h-full flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "high", "med", "low"] as PriorityFilter[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition capitalize",
                priority === p ? "bg-midnight text-white ring-midnight" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50",
              )}
            >
              {p === "all" ? "All" : p}
            </button>
          ))}
        </div>
        <div className="ml-auto flex rounded-lg ring-1 ring-inset ring-zinc-200 bg-white p-0.5">
          <ViewBtn active={view === "list"} onClick={() => setView("list")} label="List"><ListIcon className="h-4 w-4" /></ViewBtn>
          <ViewBtn active={view === "board"} onClick={() => setView("board")} label="Board"><LayoutGrid className="h-4 w-4" /></ViewBtn>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : query.error ? (
        <Card><CardBody className="text-sm text-red-600">{query.error instanceof Error ? query.error.message : "Failed to load."}</CardBody></Card>
      ) : !filtered.length ? (
        <EmptyState title="No corrective actions" description="Nothing matches these filters." />
      ) : view === "board" ? (
        <BoardView rows={filtered} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="hidden grid-cols-[2fr_1fr_1fr_90px_120px_110px] gap-3 border-b border-zinc-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 lg:grid">
            <span>Action</span><span>Store</span><span>Owner</span><span>Priority</span><span>Status</span><span>Due</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {filtered.map((ca) => <CapaRowItem key={ca.id} ca={ca} />)}
          </div>
        </div>
      )}
    </div>
  );
}

const TONE: Record<string, string> = {
  info: "text-blue-700",
  danger: "text-red-600",
  warning: "text-amber-600",
  success: "text-emerald-600",
};
function StatCard({ label, value, tone, active, onClick }: { label: string; value: number; tone: keyof typeof TONE; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-white px-4 py-3 text-left transition",
        active ? "border-accent ring-1 ring-accent" : "border-zinc-200 hover:border-zinc-300",
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 text-2xl font-bold tabular-nums", TONE[tone])}>{value}</div>
    </button>
  );
}

function ViewBtn({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition", active ? "bg-midnight text-white" : "text-zinc-500 hover:text-midnight")}
    >
      {children}
      {label}
    </button>
  );
}

function CapaRowItem({ ca }: { ca: CapaRow }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const [notes, setNotes] = useState(ca.resolutionNotes ?? "");
  const overdue = isOverdue(ca);

  const photos = useQuery({
    queryKey: ["wt-capa-photos", ca.id],
    queryFn: () => getCapaPhotos(ca.originPhotoIds),
    enabled: open && ca.originPhotoIds.length > 0,
  });
  const mutate = useMutation({
    mutationFn: (patch: { status?: CapaStatus; resolutionNotes?: string }) => updateCorrectiveAction(ca.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wt-capa"] });
      toast.push("Corrective action updated", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Update failed", "error"),
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-1 gap-1 px-4 py-3 text-left hover:bg-zinc-50 lg:grid-cols-[2fr_1fr_1fr_90px_120px_110px] lg:items-center lg:gap-3"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-midnight">{ca.title}</div>
          <div className="font-mono text-[11px] text-zinc-400">{ca.sourceItemCode}</div>
        </div>
        <div className="truncate text-sm text-zinc-600">Store #{ca.storeNumber}</div>
        <div className="truncate text-sm text-zinc-600">{ca.ownerName}</div>
        <div><PriorityChip priority={ca.priority} /></div>
        <div>{overdue ? <StatusChip status="open" /> : <StatusChip status={ca.status} />}</div>
        <div className="flex items-center gap-1.5">
          <span className={cn("text-sm", overdue ? "font-medium text-red-600" : "text-zinc-500")}>
            {ca.dueAt ? (overdue ? overdueLabel(ca.dueAt) : new Date(ca.dueAt).toLocaleDateString()) : "—"}
          </span>
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-zinc-400 transition lg:ml-0", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-zinc-100 bg-zinc-50/40 p-4">
          {ca.originPhotoIds.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Origin photos</div>
              {photos.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(photos.data ?? []).map((p) => (p.url ? (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.url} alt="" className="h-20 w-20 rounded-md object-cover ring-1 ring-zinc-200" />
                    </a>
                  ) : null))}
                </div>
              )}
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Resolution notes</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (ca.resolutionNotes ?? "")) mutate.mutate({ resolutionNotes: notes }); }}
              placeholder="What was done…"
              className="mt-1 w-full resize-none rounded-md bg-white px-3 py-2 text-sm text-midnight ring-1 ring-inset ring-zinc-200 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {NEXT[ca.status].map((t) => (
              <Button key={t.to} size="sm" variant={t.to === "closed" ? "primary" : "secondary"} disabled={mutate.isPending} onClick={() => mutate.mutate({ status: t.to })}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Board view — kanban columns by status. Read-only summary cards; work them
// from the List view.
const COLUMNS: { status: CapaStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "verified", label: "Awaiting DO" },
  { status: "closed", label: "Closed" },
];
function BoardView({ rows }: { rows: CapaRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = rows.filter((r) => r.status === col.status);
        return (
          <div key={col.status} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{col.label}</span>
              <span className="text-xs font-semibold tabular-nums text-zinc-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((ca) => {
                const overdue = isOverdue(ca);
                return (
                  <div key={ca.id} className="rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-zinc-200">
                    <div className="truncate text-[13px] font-medium text-midnight">{ca.title}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <PriorityChip priority={ca.priority} />
                      {overdue && ca.dueAt && <span className="text-[11px] font-medium text-red-600">{overdueLabel(ca.dueAt)}</span>}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">Store #{ca.storeNumber} · {ca.ownerName}</div>
                  </div>
                );
              })}
              {!items.length && <div className="px-1 py-3 text-center text-[11px] text-zinc-400">None</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
