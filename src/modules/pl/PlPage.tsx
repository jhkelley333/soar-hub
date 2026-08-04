// /pl — store P&L statements. DO+ land on an overview table of their
// visible stores' headline metrics (Sales, CI $, CI %) for the selected
// period and drill into a store's full statement; a GM (single store)
// jumps straight to their statement. Admins get an Upload panel that
// parses the accounting side-by-side workbook in the browser (SheetJS,
// dynamically imported) and batch-saves via netlify/functions/pl.
//
// Flags review + notes write-back (Google Sheet column N) is the next
// phase and will slot into the statement view.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowLeftRight, ArrowUp, ArrowUpDown, CheckCircle2, ChevronRight, Download, Eye, EyeOff, Flag, Loader2, SlidersHorizontal, Trash2, TrendingDown, TrendingUp, Upload, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fiscalInfo, FISCAL } from "@/lib/fiscal";
import { Modal } from "@/shared/ui/Modal";
import { deletePlManualFlag, fetchPlCompare, fetchPlFlags, fetchPlLineTrend, fetchPlManualFlags, fetchPlOverview, fetchPlPeriods, fetchPlReview, fetchPlReviewSummary, fetchPlRollup, fetchPlRollupLineTrend, fetchPlRollupStatement, fetchPlStatement, savePlFlagNote, savePlManualFlag, uploadPl, type PlFlag, type PlManualFlag, type PlRollupGroup, type PlTrendPoint, type RollupGroupBy } from "./api";
import { BudgetTargetsModal } from "./BudgetTargetsModal";
import { PlReviewPanel } from "./PlReviewPanel";
import type { ParsedWorkbook, PlCompareLine, PlLine, PlOverviewRow, PlStage } from "./types";

const money = (v: number | null | undefined, dp = 0) =>
  v == null
    ? "—"
    : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);

// Display sugar: the accounting "Cost of Sales" line is the store's total food
// cost — show both terms so the team reads it unambiguously.
function plLineLabel(label: string): string {
  const n = label.trim().toLowerCase();
  if (n === "cost of sales" || n === "total cost of sales") return `${label} (Total Food Cost)`;
  return label;
}

type SortKey = "store" | "sales" | "ci" | "ci_pct" | "ebitda" | "notes";
type SortDir = "asc" | "desc";

export function PlPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [period, setPeriod] = useState<string>("");
  const [store, setStore] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [view, setView] = useState<"stores" | "rollup">("stores");
  const [groupBy, setGroupBy] = useState<RollupGroupBy>("do");
  // When set, show a leader's / the company's aggregated income statement.
  const [rollupView, setRollupView] = useState<{ groupBy: RollupGroupBy; name: string } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "ci_pct", dir: "asc" });

  const periodsQ = useQuery({ queryKey: ["pl-periods"], queryFn: fetchPlPeriods });
  const periods = useMemo(() => periodsQ.data?.periods ?? [], [periodsQ.data]);
  useEffect(() => {
    if (!period && periods.length) setPeriod(periods[0].period_end);
  }, [period, periods]);

  const overviewQ = useQuery({
    queryKey: ["pl-overview", period],
    queryFn: () => fetchPlOverview(period),
    enabled: !!period,
    staleTime: 5 * 60_000,
  });
  const rows = useMemo(() => overviewQ.data?.rows ?? [], [overviewQ.data]);
  const reviewSummaryQ = useQuery({
    queryKey: ["pl-review-summary", period],
    queryFn: () => fetchPlReviewSummary(period),
    enabled: !!period,
    staleTime: 30_000,
  });
  const reviewByStore = useMemo(
    () => new Map((reviewSummaryQ.data?.rows ?? []).map((r) => [r.store_number, r])),
    [reviewSummaryQ.data],
  );
  const rollupQ = useQuery({
    queryKey: ["pl-rollup", period, groupBy],
    queryFn: () => fetchPlRollup(period, groupBy),
    enabled: !!period && view === "rollup",
    staleTime: 30_000,
  });

  // Single-store viewers (GMs) jump straight into their statement.
  useEffect(() => {
    if (!store && rows.length === 1) setStore(rows[0].store_number);
  }, [store, rows]);

  const sorted = useMemo(() => {
    const val = (r: PlOverviewRow): number | string => {
      switch (sort.key) {
        case "store": return String(r.store_number);
        case "sales": return r.total_sales ?? -Infinity;
        case "ci": return r.ci_amount ?? -Infinity;
        case "ci_pct": return r.ci_pct ?? -Infinity;
        case "ebitda": return r.ebitda ?? -Infinity;
        case "notes": return r.note_count ?? 0; // notes saved for this period
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string, undefined, { numeric: true }) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort]);

  const activePeriod = periods.find((p) => p.period_end === period);
  const periodLbl = activePeriod ? periodDisplay(activePeriod.period_label, activePeriod.period_end, activePeriod.is_final) : period;

  if (store && period) {
    return (
      <StatementView
        store={store}
        period={period}
        periodLabel={periodLbl}
        onBack={rows.length > 1 ? () => setStore(null) : undefined}
      />
    );
  }

  if (rollupView && period) {
    return (
      <RollupStatementView
        groupBy={rollupView.groupBy}
        name={rollupView.name}
        period={period}
        periodLabel={periodLbl}
        onBack={() => setRollupView(null)}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="P&L"
        description="Store income statements — sales, controllable income, and the full statement per period."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {periods.length > 0 && (
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none"
              >
                {periods.map((p) => (
                  <option key={p.period_end} value={p.period_end}>
                    {periodDisplay(p.period_label, p.period_end, p.is_final)}
                  </option>
                ))}
              </select>
            )}
            <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-zinc-200">
              {(["stores", "rollup"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn("px-3 py-1.5 text-sm font-semibold capitalize transition",
                    view === v ? "bg-accent text-white" : "bg-white text-zinc-600 hover:bg-zinc-50")}
                >
                  {v === "stores" ? "Stores" : "Roll-up"}
                </button>
              ))}
            </div>
            {view === "rollup" && (
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as RollupGroupBy)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none"
              >
                <option value="do">by DO</option>
                <option value="sdo">by SDO</option>
                <option value="rvp">by RVP</option>
                <option value="company">Company</option>
              </select>
            )}
            <button
              type="button"
              onClick={() => setBudgetOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent"
            >
              <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
              Budget &amp; Targets
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setUploadOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent"
              >
                <Upload className="h-4 w-4" strokeWidth={2} />
                Upload P&L
              </button>
            )}
          </div>
        }
      />
      <BudgetTargetsModal open={budgetOpen} onClose={() => setBudgetOpen(false)} />

      {uploadOpen && isAdmin && <UploadPanel onDone={() => setUploadOpen(false)} />}

      {view === "rollup" && periods.length > 0 ? (
        <RollupTable
          groups={rollupQ.data?.groups ?? []}
          isLoading={rollupQ.isLoading}
          isError={rollupQ.isError}
          error={rollupQ.error as Error | null}
          groupBy={groupBy}
          onOpenStore={(sn) => setStore(sn)}
          onOpenGroup={(name) => setRollupView({ groupBy, name })}
        />
      ) : periodsQ.isLoading || (overviewQ.isLoading && !!period) ? (
        <Skeleton className="h-64 w-full" />
      ) : periods.length === 0 ? (
        <EmptyState
          title="No P&L uploaded yet"
          description={isAdmin ? "Use Upload P&L to load the first period from the accounting workbook." : "P&L data appears once accounting's statements are loaded."}
        />
      ) : overviewQ.isError ? (
        <EmptyState title="Couldn't load P&L" description={(overviewQ.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="No statements for your stores" description="This period has no P&L rows for stores in your scope." />
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
                  <Th label="Store" k="store" sort={sort} onSort={setSort} />
                  <Th label="Sales" k="sales" sort={sort} onSort={setSort} right />
                  <Th label="CI $" k="ci" sort={sort} onSort={setSort} right />
                  <Th label="CI %" k="ci_pct" sort={sort} onSort={setSort} right />
                  <Th label="EBITDA" k="ebitda" sort={sort} onSort={setSort} right />
                  <th className="px-4 py-2 text-right">Review</th>
                  <Th label="Notes" k="notes" sort={sort} onSort={setSort} right />
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map((r) => (
                  <tr key={r.store_number} className="cursor-pointer hover:bg-zinc-50" onClick={() => setStore(r.store_number)}>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-midnight">#{r.store_number}</span>
                      <span className="ml-2 text-zinc-500">{r.store_name ?? ""}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-midnight">{money(r.total_sales)}</td>
                    <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", (r.ci_amount ?? 0) < 0 ? "text-red-600" : "text-midnight")}>{money(r.ci_amount)}</td>
                    <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", (r.ci_pct ?? 0) < 0 ? "text-red-600" : "text-emerald-700")}>{pct(r.ci_pct)}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", (r.ebitda ?? 0) < 0 ? "text-red-600" : "text-zinc-600")}>{money(r.ebitda)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <ReviewPill summary={reviewByStore.get(r.store_number)} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PeriodNotesPill count={r.note_count ?? 0} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-accent">View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function periodDisplay(label: string | null, end: string, isFinal: boolean): string {
  return `${label ?? end}${isFinal ? " · Final" : " · Prelim"}`;
}
// "2026-01-25" -> "Jan 2026" for prior-note labels.
function plPeriodShort(end: string): string {
  return new Date(`${end}T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// Walkthrough-flag note status: amber while notes are owed, green once
// every flag has one. No pill when the store has no flags this period.
function NotesPill({ stats }: { stats?: { total: number; noted: number } }) {
  if (!stats || stats.total === 0) return <span className="text-xs text-zinc-300">—</span>;
  const needed = stats.total - stats.noted;
  if (needed > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
        {needed} note{needed === 1 ? "" : "s"} needed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      {stats.noted} noted
    </span>
  );
}

// Overview column pill — counts flag-notes SAVED for the selected period (not
// the live walkthrough sheet), so past periods with no notes show nothing.
function PeriodNotesPill({ count }: { count: number }) {
  if (!count) return <span className="text-xs text-zinc-300">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      {count} noted
    </span>
  );
}

// Review roll-up pill — "Signed off" (green ✓) once the DO signs, "Re-sign"
// (amber) if notes changed after; else amber when notes are owed, green when
// every flag has a note, dim when there's nothing to review.
function ReviewPill({ summary }: { summary?: { flags: number; owed: number; signed?: boolean; signed_stale?: boolean; signed_by?: string | null } }) {
  if (!summary || summary.flags === 0) return <span className="text-xs text-zinc-300">—</span>;
  if (summary.signed && !summary.signed_stale) {
    return (
      <span title={summary.signed_by ? `Signed off by ${summary.signed_by}` : "Signed off"}
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} /> Signed off
      </span>
    );
  }
  if (summary.signed && summary.signed_stale) {
    return (
      <span title="Notes changed since sign-off"
        className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
        Re-sign
      </span>
    );
  }
  if (summary.owed > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
        {summary.owed} to review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      Reviewed
    </span>
  );
}

// Roll-up of the caller's stores aggregated by DO / SDO / RVP.
function RollupTable({ groups, isLoading, isError, error, groupBy, onOpenStore, onOpenGroup }: {
  groups: PlRollupGroup[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  groupBy: RollupGroupBy;
  onOpenStore: (storeNumber: string) => void;
  onOpenGroup: (name: string) => void;
}) {
  const tierLabel = groupBy.toUpperCase();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <EmptyState title="Couldn't load roll-up" description={error?.message ?? "Try again."} />;
  if (groups.length === 0) return <EmptyState title="Nothing to roll up" description="No P&L for your stores in this period." />;
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
              <th className="px-4 py-2">{tierLabel}</th>
              <th className="px-4 py-2 text-right">Stores</th>
              <th className="px-4 py-2 text-right">Sales</th>
              <th className="px-4 py-2 text-right">CI $</th>
              <th className="px-4 py-2 text-right">CI %</th>
              <th className="px-4 py-2 text-right">Flags</th>
              <th className="px-4 py-2 text-right">Owed</th>
              <th className="px-4 py-2 text-right">Signed</th>
              <th className="px-4 py-2 text-right">$ Over Budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {groups.map((g) => {
              const open = expanded.has(g.name);
              const detail = g.stores_detail ?? [];
              return (
                <Fragment key={g.name}>
                  <tr className="cursor-pointer hover:bg-zinc-50" onClick={() => toggle(g.name)}>
                    <td className="px-4 py-2.5 font-semibold text-midnight">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight className={cn("h-4 w-4 shrink-0 text-zinc-400 transition-transform", open && "rotate-90")} strokeWidth={2.5} />
                        {g.name}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onOpenGroup(g.name); }}
                          className="ml-1.5 inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-accent hover:border-accent hover:bg-accent/5"
                          title={`View ${g.name}'s rolled-up P&L with line-item history`}
                        >
                          View P&amp;L →
                        </button>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{g.stores}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-midnight">{money(g.total_sales)}</td>
                    <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", g.ci_amount < 0 ? "text-red-600" : "text-midnight")}>{money(g.ci_amount)}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", (g.ci_pct ?? 0) < 0 ? "text-red-600" : "text-emerald-700")}>{pct(g.ci_pct)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{g.flags}</td>
                    <td className="px-4 py-2.5 text-right">
                      {g.owed > 0
                        ? <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">{g.owed} to review</span>
                        : g.flags > 0
                          ? <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Reviewed</span>
                          : <span className="text-xs text-zinc-300">—</span>}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", g.signed_count >= g.stores ? "text-emerald-700 font-semibold" : "text-zinc-600")}>
                      {g.signed_count}/{g.stores}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", g.dollars_over > 0 ? "text-red-600" : "text-zinc-400")}>
                      {g.dollars_over > 0 ? money(g.dollars_over) : "—"}
                    </td>
                  </tr>
                  {open && detail.map((s) => (
                    <tr key={`${g.name}:${s.store_number}`} className="cursor-pointer bg-zinc-50/50 hover:bg-zinc-100/60" onClick={() => onOpenStore(s.store_number)}>
                      <td className="py-2 pl-11 pr-4 text-midnight">
                        <span className="font-medium">#{s.store_number}</span>
                        {s.store_name && <span className="ml-1.5 text-zinc-500">{s.store_name}</span>}
                      </td>
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-600">{money(s.total_sales)}</td>
                      <td className={cn("px-4 py-2 text-right tabular-nums", s.ci_amount < 0 ? "text-red-600" : "text-zinc-700")}>{money(s.ci_amount)}</td>
                      <td className={cn("px-4 py-2 text-right tabular-nums", (s.ci_pct ?? 0) < 0 ? "text-red-600" : "text-emerald-700")}>{pct(s.ci_pct)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-600">{s.flags}</td>
                      <td className="px-4 py-2 text-right">
                        {s.owed > 0
                          ? <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">{s.owed}</span>
                          : s.flags > 0
                            ? <span className="text-[11px] text-emerald-600">✓</span>
                            : <span className="text-xs text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {s.signed && !s.signed_stale
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />Signed</span>
                          : s.signed_stale
                            ? <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">Re-sign</span>
                            : <span className="text-xs text-zinc-300">—</span>}
                      </td>
                      <td className={cn("px-4 py-2 text-right tabular-nums", s.dollars_over > 0 ? "text-red-600" : "text-zinc-400")}>
                        {s.dollars_over > 0 ? money(s.dollars_over) : "—"}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ label, k, sort, onSort, right }: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-4 py-2", right && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(active ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "store" ? "asc" : "desc" })}
        className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide hover:text-zinc-600", right && "flex-row-reverse", active && "text-accent")}
      >
        {label}
        <Icon className={cn("h-2.5 w-2.5", !active && "opacity-40")} />
      </button>
    </th>
  );
}

// The Walkthrough flags panel is retired from fiscal period 7 (FY2026)
// onward — the Preliminary Review below takes its place there. Earlier
// periods keep the panel so their walkthrough notes stay visible. A
// period_end past FY2026 is likewise "forward" of P7 and stays hidden; one
// before FY2026 keeps the panel. Notes still save to whichever P&L period
// the panel is shown for (see FlagRow → savePlFlagNote periodEnd).
function showsWalkthroughFlags(periodEnd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(periodEnd);
  if (!m) return true;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const fi = fiscalInfo(d);
  return fi ? fi.period < 7 : d < FISCAL.start;
}

// ── One store's full statement ───────────────────────────────────────
function StatementView({ store, period, periodLabel, onBack }: {
  store: string;
  period: string;
  periodLabel: string;
  onBack?: () => void;
}) {
  // undefined = "auto" (Final when it exists, else Prelim). A toggle forces one.
  const [stage, setStage] = useState<PlStage | undefined>(undefined);
  const [compareOpen, setCompareOpen] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Last-year comparison columns — on by default, hideable per user (persisted
  // in localStorage so each person's choice sticks on their own device).
  const { profile } = useAuth();
  const lyKey = `pl-show-ly:${profile?.id ?? "anon"}`;
  const [showLy, setShowLy] = useState<boolean>(() => {
    try { const v = localStorage.getItem(lyKey); return v == null ? true : v === "1"; } catch { return true; }
  });
  const toggleLy = () => setShowLy((v) => {
    const next = !v;
    try { localStorage.setItem(lyKey, next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });

  const q = useQuery({
    queryKey: ["pl-statement", store, period, stage ?? "auto"],
    queryFn: () => fetchPlStatement(store, period, stage),
    staleTime: 5 * 60_000,
  });
  const s = q.data?.statement;

  // Team-created flags on individual lines — one lookup for the whole statement.
  const manualQ = useQuery({
    queryKey: ["pl-manual-flags", store, period],
    queryFn: () => fetchPlManualFlags(store, period),
    staleTime: 30_000,
  });
  const flagByLabel = useMemo(
    () => new Map((manualQ.data?.flags ?? []).map((f) => [f.line_label, f])),
    [manualQ.data],
  );
  const canFlag = manualQ.data?.can_flag ?? false;

  // Auto-flags from the Preliminary Review, keyed by the statement line they map
  // to, so we can color a flagged line right in the statement. Shares the query
  // the review panel below already runs (same key → one fetch).
  const reviewQ = useQuery({
    queryKey: ["pl-review", store, period],
    queryFn: () => fetchPlReview(store, period),
    staleTime: 30_000,
  });
  const autoSevByLabel = useMemo(() => {
    const rank: Record<string, number> = { high: 0, med: 1, low: 2 };
    const m = new Map<string, "high" | "med" | "low">();
    for (const f of reviewQ.data?.flags ?? []) {
      const prev = m.get(f.stmt_label);
      if (!prev || rank[f.severity] < rank[prev]) m.set(f.stmt_label, f.severity);
    }
    return m;
  }, [reviewQ.data]);

  async function handlePrint() {
    if (!s) return;
    setPrinting(true);
    try {
      const [{ exportPlPdf }, review] = await Promise.all([
        import("./plPdf"),
        fetchPlReview(store, period).catch(() => null),
      ]);
      exportPlPdf(s, review);
    } finally {
      setPrinting(false);
    }
  }
  const available = q.data?.available;
  const bothStages = !!(available?.prelim && available?.final);
  const lyOn = showLy && !!s?.ly;

  if (compareOpen) {
    return (
      <CompareView store={store} period={period} periodLabel={periodLabel} onBack={() => setCompareOpen(false)} />
    );
  }

  return (
    <>
      {onBack && (
        <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight">
          <ArrowLeft className="h-4 w-4" /> All stores
        </button>
      )}
      <PageHeader
        title={s ? `#${s.store_number}${s.store_name ? ` · ${s.store_name}` : ""}` : `#${store}`}
        description={`Income statement · ${periodLabel}${s?.uploaded_by_name ? ` · uploaded by ${s.uploaded_by_name}` : ""}`}
        actions={
          s ? (
            <div className="flex flex-wrap items-center gap-2">
              {s.ly && (
                <button
                  type="button"
                  onClick={toggleLy}
                  title={`Same period last year (${s.ly.period_label ?? s.ly.period_end})`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold",
                    showLy ? "border-accent bg-accent/10 text-accent" : "border-zinc-200 text-midnight hover:border-accent",
                  )}
                >
                  {showLy ? <Eye className="h-4 w-4" strokeWidth={2} /> : <EyeOff className="h-4 w-4" strokeWidth={2} />}
                  {showLy ? "Hide last year" : "Show last year"}
                </button>
              )}
              <button
                type="button"
                onClick={handlePrint}
                disabled={printing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent disabled:opacity-50"
              >
                <Download className="h-4 w-4" strokeWidth={2} />
                {printing ? "Building…" : "Print PDF"}
              </button>
              {bothStages ? (
                <>
                  <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-zinc-200">
                    {(["prelim", "final"] as PlStage[]).map((st) => {
                      const activeStage = (s?.stage ?? "final") === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStage(st)}
                          className={cn(
                            "px-3 py-1.5 text-sm font-semibold capitalize transition",
                            activeStage ? "bg-accent text-white" : "bg-white text-zinc-600 hover:bg-zinc-50",
                          )}
                        >
                          {st}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCompareOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent"
                  >
                    <ArrowLeftRight className="h-4 w-4" strokeWidth={2} />
                    Compare Prelim → Final
                  </button>
                </>
              ) : (
                <span className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
                  s.stage === "final" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200",
                )}>
                  {s.stage === "final" ? "Final" : "Prelim"} only
                </span>
              )}
            </div>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError || !s ? (
        <EmptyState title="Couldn't load this statement" description={(q.error as Error)?.message ?? "Try again."} />
      ) : (
        <div className="space-y-5">
          {/* How-to note — orients the team on this screen. */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl bg-blue-50 px-4 py-2.5 text-sm text-blue-900 ring-1 ring-blue-200">
            <span className="font-semibold">How this works:</span>
            <span>Flagged items are at the bottom — add your notes there.</span>
            <span className="inline-flex items-center gap-1">
              Click the <Flag className="h-3.5 w-3.5 text-blue-500" strokeWidth={2} /> flag next to a line to flag it,
            </span>
            <span>and click a line item to see its trend.</span>
          </div>

          {/* Hero metrics — the focus numbers. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Total Sales" value={money(s.total_sales)} tone="neutral" />
            <Tile label="Controllable Income $" value={money(s.ci_amount)} tone={(s.ci_amount ?? 0) < 0 ? "bad" : "ok"} />
            <Tile label="Controllable Income %" value={pct(s.ci_pct)} tone={(s.ci_pct ?? 0) < 0 ? "bad" : "ok"} />
          </div>

          {/* Walkthrough flags + notes — write back to the review sheet.
              Retired from P7 onward, where the Preliminary Review replaces it. */}
          {showsWalkthroughFlags(period) && <FlagsSection store={store} />}

          {/* Full statement */}
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
            {lyOn && (
              <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-1.5 text-[11px] text-zinc-500">
                Comparing to last year — <span className="font-semibold">{s.ly!.period_label ?? s.ly!.period_end}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <div className={cn(
                "grid gap-x-6 border-b border-zinc-100 px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400",
                lyOn ? "min-w-[760px] grid-cols-[1fr_auto_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto]",
              )}>
                <span>Line</span>
                <span className="w-28 text-right">$</span>
                <span className="w-20 text-right">% Sales</span>
                {lyOn && <span className="w-28 text-right text-zinc-400">LY $</span>}
                {lyOn && <span className="w-20 text-right text-zinc-400">LY %</span>}
                {lyOn && <span className="w-28 text-right text-zinc-400">YoY Δ $</span>}
              </div>
              <div>
                {s.lines.map((l, i) => (
                  <LineRow
                    key={`${l.label}-${i}`}
                    line={l}
                    store={store}
                    period={period}
                    flag={flagByLabel.get(l.label) ?? null}
                    autoSev={autoSevByLabel.get(l.label) ?? null}
                    canFlag={canFlag}
                    showLy={lyOn}
                  />
                ))}
              </div>
            </div>
          </div>

          <PlReviewPanel store={store} period={period} />
        </div>
      )}
    </>
  );
}

// ── Prelim → Final side-by-side comparison ───────────────────────────
function CompareView({ store, period, periodLabel, onBack }: {
  store: string;
  period: string;
  periodLabel: string;
  onBack: () => void;
}) {
  const [changedOnly, setChangedOnly] = useState(false);
  const q = useQuery({
    queryKey: ["pl-compare", store, period],
    queryFn: () => fetchPlCompare(store, period),
    staleTime: 5 * 60_000,
  });
  const c = q.data;

  const rows = useMemo(
    () => (c ? (changedOnly ? c.lines.filter((l) => l.changed) : c.lines) : []),
    [c, changedOnly],
  );

  function exportCsv() {
    if (!c) return;
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Line", "Prelim $", "Final $", "Δ $", "Δ %", "Prelim %", "Final %"];
    const body = c.lines.map((l) => [
      l.label,
      l.prelim_amount ?? "",
      l.final_amount ?? "",
      l.delta ?? "",
      pctChange(l.prelim_amount, l.final_amount) ?? "",
      l.prelim_pct ?? "",
      l.final_pct ?? "",
    ]);
    const csv = [head, ...body].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pl-compare-${store}-${period}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight">
        <ArrowLeft className="h-4 w-4" /> Back to statement
      </button>
      <PageHeader
        title={c ? `#${c.store_number}${c.store_name ? ` · ${c.store_name}` : ""} — Prelim → Final` : `#${store} — Prelim → Final`}
        description={`What changed between Preliminary and Final · ${periodLabel}`}
        actions={
          c ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700">
                <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
                Changed lines only ({c.changed_count})
              </label>
              <button
                type="button"
                onClick={exportCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent"
              >
                <Download className="h-4 w-4" strokeWidth={2} /> Export CSV
              </button>
            </div>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError || !c ? (
        <EmptyState
          title="Couldn't compare"
          description={(q.error as Error)?.message ?? "Both a Preliminary and a Final P&L are required."}
        />
      ) : (
        <div className="space-y-5">
          {/* Headline movers */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MoverTile label="Total Sales" d={c.headline.total_sales} />
            <MoverTile label="Gross Profit" d={c.headline.gross_profit} />
            <MoverTile label="CI $" d={c.headline.ci_amount} />
            <MoverTile label="CI %" d={c.headline.ci_pct} isPct />
            <MoverTile label="EBITDA" d={c.headline.ebitda} />
          </div>

          {/* Line-by-line */}
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400">
                    <th className="px-5 py-2 text-left">Line</th>
                    <th className="px-3 py-2 text-right">Prelim</th>
                    <th className="px-3 py-2 text-right">Final</th>
                    <th className="px-3 py-2 text-right">Δ $</th>
                    <th className="px-5 py-2 text-right">Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l, i) => (
                    <CompareRow key={`${l.label}-${i}`} line={l} />
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-zinc-400">No changed lines — Prelim and Final match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// % change of a line from prelim to final (relative to prelim), or null.
function pctChange(prelim: number | null, final: number | null): number | null {
  if (prelim == null || final == null || prelim === 0) return null;
  return ((final - prelim) / Math.abs(prelim)) * 100;
}

function CompareRow({ line }: { line: PlCompareLine }) {
  const changed = line.changed;
  const up = (line.delta ?? 0) > 0;
  const pc = pctChange(line.prelim_amount, line.final_amount);
  return (
    <tr className={cn("border-b border-zinc-50", line.total && "bg-zinc-50 font-bold text-midnight", changed && !line.total && "bg-amber-50/40")}>
      <td className={cn("px-5 py-1.5", !line.total && "pl-8 text-zinc-700")}>{line.label}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">{money(line.prelim_amount, 2)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-midnight">{money(line.final_amount, 2)}</td>
      <td className={cn("px-3 py-1.5 text-right tabular-nums font-semibold", !changed ? "text-zinc-300" : up ? "text-emerald-700" : "text-red-600")}>
        {line.delta == null ? "—" : `${up ? "+" : "−"}${money(Math.abs(line.delta), 2).replace(/^−/, "")}`}
      </td>
      <td className={cn("px-5 py-1.5 text-right tabular-nums", !changed ? "text-zinc-300" : up ? "text-emerald-700" : "text-red-600")}>
        {pc == null ? "—" : `${pc > 0 ? "+" : ""}${pc.toFixed(1)}%`}
      </td>
    </tr>
  );
}

function MoverTile({ label, d, isPct }: { label: string; d: { prelim: number | null; final: number | null; delta: number | null }; isPct?: boolean }) {
  const fmt = (v: number | null) => (v == null ? "—" : isPct ? pct(v) : money(v));
  const moved = d.delta != null && Math.abs(d.delta) >= (isPct ? 0.005 : 0.005);
  const up = (d.delta ?? 0) > 0;
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-midnight">{fmt(d.final)}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs">
        <span className="text-zinc-400">from {fmt(d.prelim)}</span>
        {moved && (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", up ? "text-emerald-700" : "text-red-600")}>
            {up ? <TrendingUp className="h-3 w-3" strokeWidth={2.5} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
            {up ? "+" : "−"}{isPct ? `${Math.abs(d.delta!).toFixed(2)} pts` : money(Math.abs(d.delta!)).replace(/^−/, "")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Flags for one store — from the walkthrough sheet, notes write back. ──
function FlagsSection({ store }: { store: string }) {
  const q = useQuery({
    queryKey: ["pl-flags", store],
    queryFn: () => fetchPlFlags(store),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Aggregate across every returned entry for this store — resilient to a
  // sheet layout that produces more than one entry per store number.
  const flags = (q.data?.stores ?? []).flatMap((s) => s.flags);

  // Quietly absent when the sheet has no flags for this store (or the
  // sheet integration isn't reachable) — the statement is the main event.
  if (q.isLoading || q.isError || !q.data?.period_end || flags.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-amber-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3">
        <div>
          <div className="text-sm font-semibold text-amber-900">
            Walkthrough flags ({flags.length})
          </div>
          <div className="text-xs text-amber-700">
            From the period review — add a note per flag; it saves here and writes back to the review
            sheet.
          </div>
        </div>
        <NotesPill
          stats={{ total: flags.length, noted: flags.filter((f) => (f.note ?? "").trim().length > 0).length }}
        />
      </div>
      <div className="divide-y divide-zinc-100">
        {flags.map((f) => (
          <FlagRow key={`${f.category}-${f.item}-${f.sheet_row}`} flag={f} store={store} periodEnd={q.data!.period_end!} />
        ))}
      </div>
    </div>
  );
}

// First "$1,234.56"-style amount in a flag value string, or null.
function flagMoney(s: string | null | undefined): number | null {
  const m = /\$\s*(-?[\d,]+(?:\.\d+)?)/.exec(String(s ?? ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// Trend vs the prior periods for an EXPENSE flag: rising spend is the bad
// direction. Compares the flag's current $ against May (prior_1) and Apr
// (prior_2) when those parse.
function flagTrend(flag: PlFlag): { dir: "up" | "down"; label: string } | null {
  const cur = flagMoney(flag.value);
  const p1 = flagMoney(flag.prior_1);
  if (cur == null || p1 == null || cur === p1) return null;
  const p2 = flagMoney(flag.prior_2);
  const rising = cur > p1;
  const streak = rising && p2 != null && p1 > p2;
  return {
    dir: rising ? "up" : "down",
    label: streak ? "rising 2 periods" : `${rising ? "up" : "down"} vs May`,
  };
}

const plUsd = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Small SVG line chart of a line item's amount across periods, with the value
// labelled at each point and the period on the x-axis.
function TrendChart({ points }: { points: PlTrendPoint[] }) {
  const W = 460, H = 170, padL = 12, padR = 12, padT = 18, padB = 26;
  // Contra-revenue lines (DISCOUNTS etc.) are stored negative — plot by
  // magnitude so a growing amount trends UP, while labels keep the real sign.
  const contra = points.length > 0 && points.every((p) => (p.amount ?? 0) <= 0) && points.some((p) => (p.amount ?? 0) < 0);
  const mag = (a: number | null) => (contra ? Math.abs(a ?? 0) : (a ?? 0));
  const vals = points.map((p) => mag(p.amount));
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || Math.abs(max) || 1;
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, points.length - 1);
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(mag(p.amount)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Line item trend">
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#e4e4e7" />
      <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(mag(p.amount))} r={3.5} fill="#2563eb" />
          <text x={x(i)} y={y(mag(p.amount)) - 8} textAnchor="middle" fontSize={9} fill="#3f3f46">
            {p.amount == null ? "" : Math.round(p.amount).toLocaleString()}
          </text>
          <text x={x(i)} y={H - padB + 15} textAnchor="middle" fontSize={9} fill="#a1a1aa">
            {p.period_end ? plPeriodShort(p.period_end) : (p.period_label ?? "")}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function LineTrendModal({ open, onClose, store, label, flag }: {
  open: boolean; onClose: () => void; store: string; label: string; flag?: PlFlag;
}) {
  const q = useQuery({
    queryKey: ["pl-line-trend", store, label],
    queryFn: () => fetchPlLineTrend(store, label),
    enabled: open && !!label,
  });
  const points = q.data?.points ?? [];
  // Fallback to the review sheet's own current + prior_1 + prior_2 when the P&L
  // statements don't carry (or don't match) this line — flags only.
  const fallback: PlTrendPoint[] = [];
  if (flag && points.length < 2) {
    const cur = flagMoney(flag.value), p1 = flagMoney(flag.prior_1), p2 = flagMoney(flag.prior_2);
    if (p2 != null) fallback.push({ period_end: "", period_label: "2 ago", amount: p2, pct: null });
    if (p1 != null) fallback.push({ period_end: "", period_label: "1 ago", amount: p1, pct: null });
    if (cur != null) fallback.push({ period_end: "", period_label: "Now", amount: cur, pct: null });
  }
  const shown = points.length >= 2 ? points : fallback;
  return (
    <Modal open={open} onClose={onClose} title={`${label} — trend`}>
      {q.isLoading ? (
        <div className="py-6 text-center text-sm text-zinc-500">Loading trend…</div>
      ) : shown.length < 2 ? (
        <div className="py-6 text-center text-sm text-zinc-500">Not enough history yet to chart this line — upload more P&amp;L periods.</div>
      ) : (
        <div className="space-y-3">
          <TrendChart points={shown} />
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="py-1">Period</th><th className="py-1 text-right">Amount</th><th className="py-1 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((p, i) => (
                <tr key={i} className="border-t border-zinc-100">
                  <td className="py-1.5">{p.period_end ? plPeriodShort(p.period_end) : p.period_label}</td>
                  <td className="py-1.5 text-right tabular-nums">{plUsd(p.amount)}</td>
                  <td className="py-1.5 text-right tabular-nums text-zinc-500">{p.pct == null ? "—" : `${p.pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {points.length < 2 && (
            <p className="text-[11px] text-zinc-400">Showing the review sheet's values — full P&amp;L history wasn't matched for this line.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── A leader's / the company's rolled-up income statement ────────────
// One P&L for the whole group: every line summed across their stores, each
// clickable through to its aggregated history. Reached from the roll-up table's
// "View P&L" button.
function RollupStatementView({ groupBy, name, period, periodLabel, onBack }: {
  groupBy: RollupGroupBy;
  name: string;
  period: string;
  periodLabel: string;
  onBack: () => void;
}) {
  const { profile } = useAuth();
  const lyKey = `pl-show-ly:${profile?.id ?? "anon"}`;
  const [showLy, setShowLy] = useState<boolean>(() => {
    try { const v = localStorage.getItem(lyKey); return v == null ? true : v === "1"; } catch { return true; }
  });
  const toggleLy = () => setShowLy((v) => {
    const next = !v;
    try { localStorage.setItem(lyKey, next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });

  const q = useQuery({
    queryKey: ["pl-rollup-statement", groupBy, name, period],
    queryFn: () => fetchPlRollupStatement(period, groupBy, name),
    staleTime: 5 * 60_000,
  });
  const s = q.data?.statement;
  const lyOn = showLy && !!s?.ly;
  const tierLabel = groupBy === "company" ? "Company" : groupBy.toUpperCase();

  return (
    <>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight">
        <ArrowLeft className="h-4 w-4" /> Back to roll-up
      </button>
      <PageHeader
        title={`${name} — Rolled-up P&L`}
        description={`${tierLabel} · ${periodLabel}${s ? ` · ${s.stores} store${s.stores === 1 ? "" : "s"}` : ""}`}
        actions={
          s ? (
            <div className="flex flex-wrap items-center gap-2">
              {s.ly && (
                <button
                  type="button"
                  onClick={toggleLy}
                  title={`Same period last year (${s.ly.period_label ?? s.ly.period_end})`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold",
                    showLy ? "border-accent bg-accent/10 text-accent" : "border-zinc-200 text-midnight hover:border-accent",
                  )}
                >
                  {showLy ? <Eye className="h-4 w-4" strokeWidth={2} /> : <EyeOff className="h-4 w-4" strokeWidth={2} />}
                  {showLy ? "Hide last year" : "Show last year"}
                </button>
              )}
              <span className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
                s.stage === "final" ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : s.stage === "prelim" ? "bg-amber-50 text-amber-700 ring-amber-200"
                    : "bg-zinc-100 text-zinc-600 ring-zinc-200",
              )}>
                {s.stage === "final" ? "Final" : s.stage === "prelim" ? "Prelim" : "Mixed Prelim/Final"}
              </span>
            </div>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError || !s ? (
        <EmptyState title="Couldn't load this roll-up" description={(q.error as Error)?.message ?? "Try again."} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl bg-blue-50 px-4 py-2.5 text-sm text-blue-900 ring-1 ring-blue-200">
            <span className="font-semibold">Rolled-up P&amp;L:</span>
            <span>every line is summed across {groupBy === "company" ? "the company's" : `this ${tierLabel}'s`} stores, with % on the combined sales.</span>
            <span>Click any line item to see its history across periods.</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Total Sales" value={money(s.total_sales)} tone="neutral" />
            <Tile label="Controllable Income $" value={money(s.ci_amount)} tone={(s.ci_amount ?? 0) < 0 ? "bad" : "ok"} />
            <Tile label="Controllable Income %" value={pct(s.ci_pct)} tone={(s.ci_pct ?? 0) < 0 ? "bad" : "ok"} />
          </div>

          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
            {lyOn && (
              <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-1.5 text-[11px] text-zinc-500">
                Comparing to last year — <span className="font-semibold">{s.ly!.period_label ?? s.ly!.period_end}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <div className={cn(
                "grid gap-x-6 border-b border-zinc-100 px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400",
                lyOn ? "min-w-[760px] grid-cols-[1fr_auto_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto]",
              )}>
                <span>Line</span>
                <span className="w-28 text-right">$</span>
                <span className="w-20 text-right">% Sales</span>
                {lyOn && <span className="w-28 text-right text-zinc-400">LY $</span>}
                {lyOn && <span className="w-20 text-right text-zinc-400">LY %</span>}
                {lyOn && <span className="w-28 text-right text-zinc-400">YoY Δ $</span>}
              </div>
              <div>
                {s.lines.map((l, i) => (
                  <RollupLineRow key={`${l.label}-${i}`} line={l} groupBy={groupBy} name={name} showLy={lyOn} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RollupLineRow({ line, groupBy, name, showLy }: {
  line: PlLine;
  groupBy: RollupGroupBy;
  name: string;
  showLy: boolean;
}) {
  const [trendOpen, setTrendOpen] = useState(false);
  const d = line.amount != null && line.ly_amount != null ? line.amount - line.ly_amount : null;
  return (
    <div>
      <div className={cn(
        "grid gap-x-6 px-5 py-1.5 text-sm hover:bg-accent/5",
        showLy ? "min-w-[760px] grid-cols-[1fr_auto_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto]",
        line.total ? "border-t border-zinc-200 bg-zinc-50 font-bold text-midnight" : "text-zinc-700",
      )}>
        <span className={cn("flex items-center gap-1.5 min-w-0", !line.total && "pl-3")}>
          <button
            type="button"
            onClick={() => setTrendOpen(true)}
            title="See this line's history across periods"
            className="truncate text-left underline decoration-dotted decoration-zinc-300 underline-offset-2 hover:decoration-accent"
          >
            {plLineLabel(line.label)}
          </button>
        </span>
        <span className={cn("w-28 text-right tabular-nums", (line.amount ?? 0) < 0 && "text-red-600")}>{money(line.amount, 2)}</span>
        <span className="w-20 text-right tabular-nums text-zinc-500">{line.pct != null ? `${line.pct.toFixed(1)}%` : ""}</span>
        {showLy && (
          <span className={cn("w-28 text-right tabular-nums text-zinc-400", (line.ly_amount ?? 0) < 0 && "text-red-400")}>
            {line.ly_amount != null ? money(line.ly_amount, 2) : "—"}
          </span>
        )}
        {showLy && <span className="w-20 text-right tabular-nums text-zinc-400">{line.ly_pct != null ? `${line.ly_pct.toFixed(1)}%` : ""}</span>}
        {showLy && (
          <span className="w-28 text-right tabular-nums text-zinc-500">{d == null ? "—" : `${d > 0 ? "+" : ""}${money(d, 2)}`}</span>
        )}
      </div>
      <RollupLineTrendModal open={trendOpen} onClose={() => setTrendOpen(false)} groupBy={groupBy} name={name} label={line.label} />
    </div>
  );
}

function RollupLineTrendModal({ open, onClose, groupBy, name, label }: {
  open: boolean; onClose: () => void; groupBy: RollupGroupBy; name: string; label: string;
}) {
  const q = useQuery({
    queryKey: ["pl-rollup-line-trend", groupBy, name, label],
    queryFn: () => fetchPlRollupLineTrend(groupBy, name, label),
    enabled: open && !!label,
  });
  const points = q.data?.points ?? [];
  return (
    <Modal open={open} onClose={onClose} title={`${label} — ${name} history`}>
      {q.isLoading ? (
        <div className="py-6 text-center text-sm text-zinc-500">Loading history…</div>
      ) : points.length < 2 ? (
        <div className="py-6 text-center text-sm text-zinc-500">Not enough history yet to chart this line — upload more P&amp;L periods.</div>
      ) : (
        <div className="space-y-3">
          <TrendChart points={points} />
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="py-1">Period</th><th className="py-1 text-right">Amount</th><th className="py-1 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p, i) => (
                <tr key={i} className="border-t border-zinc-100">
                  <td className="py-1.5">{p.period_end ? plPeriodShort(p.period_end) : p.period_label}</td>
                  <td className="py-1.5 text-right tabular-nums">{plUsd(p.amount)}</td>
                  <td className="py-1.5 text-right tabular-nums text-zinc-500">{p.pct == null ? "—" : `${p.pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function FlagRow({ flag, store, periodEnd }: { flag: PlFlag; store: string; periodEnd: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [trendOpen, setTrendOpen] = useState(false);
  const [note, setNote] = useState(flag.note ?? "");
  // Re-seed when the saved note arrives after mount (cached flag data can
  // render first, then the fresh fetch lands with the note) — but never
  // clobber text the user is mid-typing.
  const seeded = useRef(flag.note ?? "");
  useEffect(() => {
    const incoming = flag.note ?? "";
    if (incoming !== seeded.current) {
      setNote((cur) => (cur.trim() === "" || cur === seeded.current ? incoming : cur));
      seeded.current = incoming;
    }
  }, [flag.note]);

  const trend = flagTrend(flag);

  const save = useMutation({
    mutationFn: () =>
      savePlFlagNote({
        period_end: periodEnd,
        store_number: store,
        category: flag.category,
        item: flag.item ?? "",
        sheet_row: flag.sheet_row,
        note: note.trim(),
      }),
    onSuccess: (r) => {
      toast.push(
        r.sheet_written ? "Note saved & written to the review sheet." : `Note saved. ${r.sheet_reason ?? ""}`,
        r.sheet_written ? "success" : "info",
      );
      qc.invalidateQueries({ queryKey: ["pl-flags"] });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save the note.", "error"),
  });

  return (
    <div className="px-5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
          {flag.category}
        </span>
        <button type="button" onClick={() => setTrendOpen(true)} title="See this line's trend across periods"
          className="text-sm font-semibold text-midnight underline decoration-dotted decoration-zinc-300 underline-offset-2 hover:decoration-accent hover:text-accent">
          {flag.item ?? flag.category}
        </button>
        <LineTrendModal open={trendOpen} onClose={() => setTrendOpen(false)} store={store}
          label={flag.item || flag.category} flag={flag} />
        {flag.value && <span className="text-sm tabular-nums text-zinc-700">{flag.value}</span>}
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              trend.dir === "up" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700",
            )}
            title="Direction vs the prior periods — for expense flags, up is the wrong way"
          >
            {trend.dir === "up" ? <TrendingUp className="h-3 w-3" strokeWidth={2.5} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
            {trend.label}
          </span>
        )}
        {flag.rule && <span className="text-xs text-amber-700">{flag.rule}</span>}
        {(flag.prior_1 || flag.prior_2) && (
          <span className="text-xs text-zinc-400">
            {[flag.prior_1, flag.prior_2].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>

      {/* The saved note, visible without touching the editor. */}
      {flag.note && (
        <div className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-100">
          <span className="whitespace-pre-wrap">{flag.note}</span>
          {flag.noted_by && (
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              — {flag.noted_by}
              {flag.noted_at ? ` · ${new Date(flag.noted_at).toLocaleString()}` : ""}
            </span>
          )}
        </div>
      )}

      {/* Prior-period notes — shown when this item was flagged before, so the
          store has the history from earlier P&Ls. */}
      {flag.prior_notes && flag.prior_notes.length > 0 && (
        <details className="mt-2 rounded-lg bg-amber-50/60 px-3 py-2 ring-1 ring-inset ring-amber-100">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Flagged before · {flag.prior_notes.length} prior note{flag.prior_notes.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 space-y-2">
            {flag.prior_notes.map((p, i) => (
              <div key={i} className="border-l-2 border-amber-200 pl-2.5 text-sm text-zinc-700">
                <span className="whitespace-pre-wrap">{p.note}</span>
                <span className="mt-0.5 block text-[11px] text-zinc-400">
                  {plPeriodShort(p.period_end)}{p.noted_by_name ? ` · ${p.noted_by_name}` : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="mt-2 flex items-start gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={1}
          placeholder={flag.note ? "Update this note…" : "Explain this flag…"}
          className="min-h-[38px] flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !note.trim() || note.trim() === (flag.note ?? "").trim()}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function LineRow({ line, store, period, flag, autoSev, canFlag, showLy }: {
  line: PlLine;
  store: string;
  period: string;
  flag: PlManualFlag | null;
  autoSev: "high" | "med" | "low" | null;
  canFlag: boolean;
  showLy: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [trendOpen, setTrendOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(flag?.reason ?? "");

  // A manual flag (deliberate team flag) takes visual priority; otherwise color
  // by the review severity. This drives the colored flag marker on the line.
  const flagged = !!flag || autoSev != null;
  const flagColor = flag
    ? "text-amber-500"
    : autoSev === "high" ? "text-red-500"
      : autoSev === "med" ? "text-amber-500"
        : autoSev === "low" ? "text-amber-400"
          : "";
  const flagTitle = flag ? "Edit this flag" : autoSev != null ? "Flagged in review — click to add a note" : "Flag this line for review";

  // Refresh the inline marker AND the review panel below (a self-flag surfaces
  // there as a card with the root-cause / action-steps workflow).
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pl-manual-flags", store, period] });
    qc.invalidateQueries({ queryKey: ["pl-review", store, period] });
  };
  const save = useMutation({
    mutationFn: () => savePlManualFlag({ store, period, line_label: line.label, reason }),
    onSuccess: () => { setEditing(false); invalidate(); toast.push(flag ? "Flag updated." : "Line flagged.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't flag this line.", "error"),
  });
  const remove = useMutation({
    mutationFn: () => deletePlManualFlag({ id: flag!.id }),
    onSuccess: () => { setEditing(false); invalidate(); toast.push("Flag cleared.", "info"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't clear the flag.", "error"),
  });

  const openFlag = () => { setReason(flag?.reason ?? ""); setEditing(true); };

  return (
    <div className={cn(flag && "bg-amber-50/40")}>
      <div
        className={cn(
          "grid gap-x-6 px-5 py-1.5 text-sm hover:bg-accent/5",
          showLy ? "min-w-[760px] grid-cols-[1fr_auto_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto]",
          line.total ? "border-t border-zinc-200 bg-zinc-50 font-bold text-midnight" : "text-zinc-700",
          flag && "bg-transparent",
        )}
      >
        <span className={cn("flex items-center gap-1.5 min-w-0", !line.total && "pl-3")}>
          {canFlag ? (
            <button
              type="button"
              onClick={openFlag}
              title={flagTitle}
              className={cn("shrink-0", flagged ? flagColor : "text-zinc-300 hover:text-amber-500")}
            >
              <Flag className="h-3.5 w-3.5" strokeWidth={2} fill={flagged ? "currentColor" : "none"} />
            </button>
          ) : flagged ? (
            <Flag className={cn("h-3.5 w-3.5 shrink-0", flagColor)} strokeWidth={2} fill="currentColor" />
          ) : null}
          <button
            type="button"
            onClick={() => setTrendOpen(true)}
            title="See this line's trend across periods"
            className="truncate text-left underline decoration-dotted decoration-zinc-300 underline-offset-2 hover:decoration-accent"
          >
            {plLineLabel(line.label)}
          </button>
        </span>
        <span className={cn("w-28 text-right tabular-nums", (line.amount ?? 0) < 0 && "text-red-600")}>
          {money(line.amount, 2)}
        </span>
        <span className="w-20 text-right tabular-nums text-zinc-500">{line.pct != null ? `${line.pct.toFixed(1)}%` : ""}</span>
        {showLy && (
          <span className={cn("w-28 text-right tabular-nums text-zinc-400", (line.ly_amount ?? 0) < 0 && "text-red-400")}>
            {line.ly_amount != null ? money(line.ly_amount, 2) : "—"}
          </span>
        )}
        {showLy && (
          <span className="w-20 text-right tabular-nums text-zinc-400">{line.ly_pct != null ? `${line.ly_pct.toFixed(1)}%` : ""}</span>
        )}
        {showLy && (() => {
          const d = line.amount != null && line.ly_amount != null ? line.amount - line.ly_amount : null;
          return (
            <span className="w-28 text-right tabular-nums text-zinc-500">
              {d == null ? "—" : `${d > 0 ? "+" : ""}${money(d, 2)}`}
            </span>
          );
        })()}
      </div>

      {/* The flag itself, shown right below the line it's on. */}
      {flag && !editing && (
        <div className="flex items-start gap-2 px-5 pb-2 pl-11 text-xs text-amber-900">
          <span className="mt-0.5 shrink-0 font-semibold uppercase tracking-wide text-amber-600">Flagged</span>
          <span className="min-w-0 flex-1">
            {flag.reason ? <span className="whitespace-pre-wrap">{flag.reason}</span> : <span className="italic text-amber-700/70">No reason given</span>}
            <span className="ml-1 text-amber-700/70">— {flag.flagged_by_name ?? "—"}{flag.flagged_by_role ? ` · ${flag.flagged_by_role.toUpperCase()}` : ""}</span>
          </span>
          {canFlag && (
            <span className="flex shrink-0 items-center gap-1.5">
              <button type="button" onClick={openFlag} title="Edit" className="text-amber-600 hover:text-amber-800">Edit</button>
              <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} title="Clear flag" className="text-amber-600 hover:text-red-600 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Compose / edit the flag reason inline. */}
      {editing && (
        <div className="px-5 pb-2.5 pl-11">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Why flag this line? (optional)"
            className="block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm ring-1 ring-inset ring-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
              <Flag className="h-3 w-3" strokeWidth={2.5} />{save.isPending ? "Saving…" : flag ? "Update flag" : "Flag line"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setReason(flag?.reason ?? ""); }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-700">
              <X className="h-3 w-3" strokeWidth={2.5} />Cancel
            </button>
          </div>
        </div>
      )}

      <LineTrendModal open={trendOpen} onClose={() => setTrendOpen(false)} store={store} label={line.label} />
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "ok" | "bad" | "neutral" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "ok" ? "text-emerald-600" : "text-midnight";
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-3xl font-bold tabular-nums", color)}>{value}</div>
    </div>
  );
}

// ── Admin upload — parse the workbook in the browser, preview, save. ──
function UploadPanel({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [parsing, setParsing] = useState(false);
  const [isFinal, setIsFinal] = useState(false);
  const [fileName, setFileName] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParsing(true);
    setParsed(null);
    setFileName(file.name);
    // "Final" workbooks usually say so in the filename; Prelim is default.
    setIsFinal(/final/i.test(file.name));
    try {
      const { parsePlWorkbook } = await import("./parseWorkbook");
      const result = await parsePlWorkbook(await file.arrayBuffer());
      setParsed(result);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Couldn't parse the workbook.", "error");
    } finally {
      setParsing(false);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      if (!parsed) throw new Error("Nothing parsed.");
      return uploadPl({
        period_end: parsed.period_end,
        period_label: parsed.suggested_label,
        is_final: isFinal,
        statements: parsed.stores,
      });
    },
    onSuccess: (r) => {
      const dups = r.duplicates ?? [];
      toast.push(
        `Saved ${r.upserted} statement${r.upserted === 1 ? "" : "s"}.` +
          (dups.length ? ` Merged ${dups.length} duplicate store column(s): ${dups.slice(0, 8).join(", ")}${dups.length > 8 ? "…" : ""}.` : "") +
          (r.unmatched.length ? ` ${r.unmatched.length} store number(s) not in the app: ${r.unmatched.slice(0, 8).join(", ")}${r.unmatched.length > 8 ? "…" : ""}` : ""),
        r.unmatched.length ? "info" : "success",
      );
      qc.invalidateQueries({ queryKey: ["pl-periods"] });
      qc.invalidateQueries({ queryKey: ["pl-overview"] });
      onDone();
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Upload failed.", "error"),
  });

  return (
    <div className="mb-5 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="text-sm font-semibold text-midnight">Upload P&L workbook</div>
      <p className="mt-0.5 text-xs text-zinc-600">
        The accounting side-by-side .xlsx (one $ + % column pair per store). Parsed entirely in your
        browser; re-uploading the same period overwrites it (Prelim → Final).
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onPick} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={parsing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent disabled:opacity-50"
        >
          {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" strokeWidth={2} />}
          {parsing ? "Parsing…" : fileName ? "Pick a different file" : "Choose .xlsx"}
        </button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700">
          <input type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          This is the Final (not Prelim)
        </label>
      </div>

      {parsed && (
        <div className="mt-3 rounded-lg bg-white p-3 text-sm ring-1 ring-zinc-200">
          <div className="font-semibold text-midnight">
            {parsed.suggested_label} · period ending {parsed.period_end} · {parsed.stores.length} stores
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Sample: {parsed.stores.slice(0, 3).map((s) => `#${s.store_number} sales ${money(s.total_sales)} / CI ${pct(s.ci_pct)}`).join(" · ")}
          </div>
          {parsed.skipped_columns.length > 0 && (
            <div className="mt-1 text-xs text-zinc-400">
              Skipped rollup columns: {parsed.skipped_columns.join(", ")}
            </div>
          )}
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {save.isPending ? "Saving…" : `Save ${parsed.stores.length} statements (${isFinal ? "Final" : "Prelim"})`}
          </button>
        </div>
      )}
    </div>
  );
}
