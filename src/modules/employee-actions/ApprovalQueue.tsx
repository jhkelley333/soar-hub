// Approver queue for Employee Actions. Lists everything awaiting the signed-in
// user's action — approvals plus the post-approval confirmations (entered /
// closed out / PAF submitted / closed) — and opens a detail drawer to act.
//
// A toolbar on top lets the approver narrow a long queue: a free-text search
// (employee or store) plus status filter chips that double as live counts.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { StatusPill } from "@/shared/ui/StatusPill";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { bulkApproveEmployeeActions, listApprovalQueue } from "./api";
import { RequestDetailDrawer } from "./RequestDetailDrawer";
import { statusKind, waitingOn } from "./statusMeta";
import type { PtoRow, TrainingCreditRow } from "./types";

function fmtMoney(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// ── Week filter helpers (date-only, local; Mon–Sun) ───────────────────────────
function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d;
}
function weekRange(anchor: Date): [Date, Date] {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return [mon, sun];
}
// True if [start,end] overlaps the week range. end defaults to start.
function inWeek(startStr: string | null | undefined, endStr: string | null | undefined, range: [Date, Date]): boolean {
  const s = parseDate(startStr);
  if (!s) return false;
  const e = parseDate(endStr) ?? s;
  return s <= range[1] && e >= range[0];
}
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The caller's next action, phrased as an imperative so it reads as a to-do —
// never as a status (e.g. "Mark complete", not "Complete", which looks done).
function actionHint(action: string | null | undefined): string {
  switch (action) {
    case "decide":
      return "Approve / send back";
    case "entered":
      return "Mark on weekly sheet";
    case "closed-out":
      return "Mark complete";
    case "paf-submitted":
      return "Confirm PAF";
    case "close":
      return "Close out";
    default:
      return "Review";
  }
}

// Preferred chip order; any status not listed is appended in encounter order.
const STATUS_ORDER = [
  "Submitted",
  "DO Approved",
  "Approved",
  "SDO/RVP Approved",
  "On Weekly Sheet",
  "PAF Submitted",
];

type Selection =
  | { kind: "training"; row: TrainingCreditRow }
  | { kind: "pto"; row: PtoRow }
  | null;

export function ApprovalQueue() {
  const [selected, setSelected] = useState<Selection>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [weekAnchor, setWeekAnchor] = useState<Date | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // keys: `${kind}:${id}`
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["ea-queue"], queryFn: listApprovalQueue });

  const range = weekAnchor ? weekRange(weekAnchor) : null;

  const bulk = useMutation({
    mutationFn: (items: { type: "training" | "pto"; id: string }[]) => bulkApproveEmployeeActions(items),
    onSuccess: (r) => {
      toast.push(
        `Approved ${r.approved}${r.failed ? ` · ${r.failed} couldn't be approved` : ""}.`,
        r.failed ? "info" : "success",
      );
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["ea-queue"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Bulk approve failed.", "error"),
  });

  const trainingCredits = query.data?.trainingCredits ?? [];
  const ptoRequests = query.data?.ptoRequests ?? [];

  const q = search.trim().toLowerCase();
  const matchesSearch = useMemo(() => {
    return (r: { employee_name?: string; store_number?: string; store_name?: string | null }) => {
      if (!q) return true;
      return (
        (r.employee_name ?? "").toLowerCase().includes(q) ||
        String(r.store_number ?? "").toLowerCase().includes(q) ||
        (r.store_name ?? "").toLowerCase().includes(q)
      );
    };
  }, [q]);

  const searchedTc = trainingCredits.filter(matchesSearch);
  const searchedPto = ptoRequests.filter(matchesSearch);

  // Status chip counts reflect the search but not the active status filter, so
  // each chip always shows how many would match if you picked it.
  const { chips, searchedTotal } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of [...searchedTc, ...searchedPto]) {
      counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    }
    const ordered = STATUS_ORDER.filter((s) => counts.has(s));
    for (const s of counts.keys()) if (!ordered.includes(s)) ordered.push(s);
    return {
      chips: ordered.map((s) => ({ status: s, count: counts.get(s) ?? 0 })),
      searchedTotal: searchedTc.length + searchedPto.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedTc.length, searchedPto.length, q]);

  const matchesStatus = (r: { status: string }) => statusFilter === "all" || r.status === statusFilter;
  const tc = searchedTc
    .filter(matchesStatus)
    .filter((r) => !range || inWeek(r.start_date, r.last_day_date, range));
  const pto = searchedPto
    .filter(matchesStatus)
    .filter((r) => !range || inWeek(r.pto_start_date, r.pto_end_date, range));
  const shown = tc.length + pto.length;

  // Bulk selection — rows the caller can approve in bulk right now (the only
  // bulk action is "decide"). The action bar offers Approve for what's picked.
  const key = (kind: "training" | "pto", id: string) => `${kind}:${id}`;
  const togglePick = (k: string) =>
    setPicked((prev) => { const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next; });
  const isBulkable = (r: { action_needed?: string | null }) => r.action_needed === "decide";
  const bulkable = [
    ...tc.filter(isBulkable).map((r) => ({ kind: "training" as const, id: r.id, action: r.action_needed })),
    ...pto.filter(isBulkable).map((r) => ({ kind: "pto" as const, id: r.id, action: r.action_needed })),
  ];
  const pickedBulk = bulkable.filter((a) => picked.has(key(a.kind, a.id)));
  const pickedDecide = pickedBulk.filter((a) => a.action === "decide").map((a) => ({ type: a.kind, id: a.id }));
  const allBulkSelected = bulkable.length > 0 && bulkable.every((a) => picked.has(key(a.kind, a.id)));
  const toggleSelectAll = () =>
    setPicked(allBulkSelected ? new Set() : new Set(bulkable.map((a) => key(a.kind, a.id))));

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <EmptyState
          title="Couldn't load the approval queue"
          description={(query.error as Error)?.message ?? "Try again."}
        />
      </Card>
    );
  }

  const total = trainingCredits.length + ptoRequests.length;

  if (!total) {
    return (
      <Card>
        <EmptyState
          title="Nothing awaiting your action"
          description="Approvals and confirmations that need you will show up here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" strokeWidth={1.75} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or store…"
            className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip label="All" count={searchedTotal} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          {chips.map((c) => (
            <Chip
              key={c.status}
              label={c.status}
              count={c.count}
              active={statusFilter === c.status}
              onClick={() => setStatusFilter(c.status)}
            />
          ))}
        </div>
      </div>

      {/* Week filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">Week</span>
        {(() => {
          const thisMon = toISO(weekRange(new Date())[0]);
          const next = new Date(); next.setDate(next.getDate() + 7);
          const nextMon = toISO(weekRange(next)[0]);
          const anchorMon = weekAnchor ? toISO(weekRange(weekAnchor)[0]) : null;
          return (
            <>
              <WeekBtn active={!weekAnchor} onClick={() => setWeekAnchor(null)}>All</WeekBtn>
              <WeekBtn active={anchorMon === thisMon} onClick={() => setWeekAnchor(new Date())}>This week</WeekBtn>
              <WeekBtn active={anchorMon === nextMon} onClick={() => setWeekAnchor(next)}>Next week</WeekBtn>
            </>
          );
        })()}
        <input
          type="date"
          value={weekAnchor ? toISO(weekAnchor) : ""}
          onChange={(e) => setWeekAnchor(e.target.value ? parseDate(e.target.value) : null)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          aria-label="Pick any date in the week"
        />
        {range && <span className="text-xs text-zinc-500">{fmtDay(range[0])} – {fmtDay(range[1])}</span>}
      </div>

      {/* Bulk actions — approve and/or mark on weekly sheet */}
      {bulkable.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={allBulkSelected} onChange={toggleSelectAll} />
            Select all ({bulkable.length})
          </label>
          <span className="ml-auto text-sm text-zinc-600">{pickedBulk.length} selected</span>
          {picked.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          )}
          {pickedDecide.length > 0 && (
            <Button size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate(pickedDecide)}>
              {bulk.isPending ? "Approving…" : `Approve ${pickedDecide.length}`}
            </Button>
          )}
        </div>
      )}

      {shown === 0 ? (
        <Card>
          <EmptyState
            title="No matches"
            description="Nothing in your queue matches that search or filter."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {tc.length > 0 && (
            <Section title="Training Credit" count={tc.length}>
              {tc.map((r) => (
                <QueueRow
                  key={r.id}
                  title={r.employee_name}
                  status={r.status}
                  waiting={waitingOn("training", r.status)}
                  hint={actionHint(r.action_needed)}
                  meta={[
                    `Store #${r.store_number}${r.store_name ? ` — ${r.store_name}` : ""}`,
                    r.training_type,
                    fmtMoney(r.requested_amount),
                  ]}
                  selectable={isBulkable(r)}
                  selected={picked.has(key("training", r.id))}
                  onToggleSelect={() => togglePick(key("training", r.id))}
                  onOpen={() => setSelected({ kind: "training", row: r })}
                />
              ))}
            </Section>
          )}
          {pto.length > 0 && (
            <Section title="PTO" count={pto.length}>
              {pto.map((r) => {
                const isHourly = r.position === "Associate Manager" || r.position === "First Assistant";
                return (
                  <QueueRow
                    key={r.id}
                    title={`${r.employee_name}`}
                    subtitle={r.position}
                    status={r.status}
                    waiting={waitingOn("pto", r.status)}
                    hint={actionHint(r.action_needed)}
                    meta={[
                      `Store #${r.store_number}${r.store_name ? ` — ${r.store_name}` : ""}`,
                      `${r.pto_start_date} → ${r.pto_end_date}`,
                      isHourly
                        ? `${r.vacation_hours ?? 0} hrs${r.amount != null ? ` · ${fmtMoney(r.amount)}` : ""}`
                        : `${r.days_used ?? 0} day(s)`,
                    ]}
                    selectable={isBulkable(r)}
                    selected={picked.has(key("pto", r.id))}
                    onToggleSelect={() => togglePick(key("pto", r.id))}
                    onOpen={() => setSelected({ kind: "pto", row: r })}
                  />
                );
              })}
            </Section>
          )}
        </div>
      )}

      <RequestDetailDrawer
        kind={selected?.kind ?? "training"}
        row={selected?.row ?? null}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-midnight px-2.5 py-1 text-xs font-medium text-white"
          : "rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200"
      }
    >
      {label} <span className={active ? "text-white/70" : "text-zinc-400"}>({count})</span>
    </button>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold tracking-tight text-midnight">
        {title} <span className="text-zinc-400">({count})</span>
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function WeekBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-midnight px-2.5 py-1 text-xs font-medium text-white"
          : "rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200"
      }
    >
      {children}
    </button>
  );
}

function QueueRow({
  title,
  subtitle,
  status,
  waiting,
  hint,
  meta,
  onOpen,
  selectable,
  selected,
  onToggleSelect,
}: {
  title: string;
  subtitle?: string;
  status: string;
  waiting?: string | null;
  hint: string;
  meta: string[];
  onOpen: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  return (
    <Card
      className={`transition hover:ring-2 hover:ring-accent/30 ${selected ? "ring-2 ring-accent/50" : ""}`}
    >
      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
        {selectable && (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-accent"
            checked={!!selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select for bulk approve"
          />
        )}
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{title}</span>
            {subtitle && <span className="text-xs text-zinc-400">{subtitle}</span>}
            <StatusPill kind={statusKind(status)}>{status}</StatusPill>
            {waiting && (
              <span className="text-xs font-medium text-sonic-700">→ Waiting on {waiting}</span>
            )}
            <Badge tone="info">{hint}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            {meta.filter(Boolean).map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>
        <button type="button" onClick={onOpen} className="shrink-0 text-xs font-medium text-accent hover:underline">Open →</button>
      </CardBody>
    </Card>
  );
}
