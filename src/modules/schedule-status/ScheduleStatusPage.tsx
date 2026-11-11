// Schedule Status — per-store ExpressWay schedule workflow state.
// Visible to DOs and above. Shows step counts + stores not yet Approved/Published
// grouped by DO, filterable by RVP/region.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchSchedWeeks, fetchSchedSummary } from "./api";
import { STEP_LABELS } from "./types";
import type { SchedStatusRow, StepCounts } from "./types";

const fmtPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtDate = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Step pill styling
const STEP_STYLE: Record<number, string> = {
  1: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  2: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  3: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400",
  4: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-500",
  5: "bg-emerald-200 text-emerald-800 dark:bg-emerald-800/50 dark:text-emerald-300",
};

function StepPill({ step, label }: { step: number | null; label: string | null }) {
  const s = step ?? 0;
  const cls = STEP_STYLE[s] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap", cls)}>
      {label ?? STEP_LABELS[s] ?? "Unknown"}
    </span>
  );
}

function StepBar({ counts, total }: { counts: StepCounts; total: number }) {
  const steps = [1, 2, 3, 4, 5] as const;
  return (
    <div className="flex flex-wrap gap-3">
      {steps.map((s) => (
        <div key={s} className="flex flex-col items-center gap-1">
          <span className="text-2xl font-bold tabular-nums">{counts[s]}</span>
          <StepPill step={s} label={null} />
        </div>
      ))}
      {counts.unknown > 0 && (
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl font-bold tabular-nums">{counts.unknown}</span>
          <span className="inline-block rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Unknown
          </span>
        </div>
      )}
      <div className="flex flex-col items-center gap-1 ml-4 pl-4 border-l border-zinc-200 dark:border-zinc-700">
        <span className="text-2xl font-bold tabular-nums text-zinc-500">{total}</span>
        <span className="text-xs text-zinc-400">Total</span>
      </div>
    </div>
  );
}

function StoreRow({ row }: { row: SchedStatusRow }) {
  const done = (row.status_step ?? 0) >= 4;
  return (
    <tr className={cn("border-b border-zinc-100 dark:border-zinc-800", done && "opacity-50")}>
      <td className="py-2 pr-3 text-sm font-medium tabular-nums w-14">{row.store_number}</td>
      <td className="py-2 pr-3 text-sm text-zinc-600 dark:text-zinc-400 truncate">{row.store_name ?? "—"}</td>
      <td className="py-2 pr-3 w-44">
        <StepPill step={row.status_step} label={row.status_label} />
      </td>
      <td className="py-2 pr-3 text-sm tabular-nums text-right w-28">
        {row.adjusted_forecast != null ? `$${Math.round(row.adjusted_forecast).toLocaleString()}` : row.forecast != null ? `$${Math.round(row.forecast).toLocaleString()}` : "—"}
      </td>
      <td className="py-2 pr-3 text-sm tabular-nums text-right w-20">{fmtPct(row.scheduled_labor_pct)}</td>
      <td className="py-2 pr-3 text-sm tabular-nums text-right w-20">{fmtPct(row.target_labor_pct)}</td>
      <td className="py-2 text-sm tabular-nums text-right w-20">{fmtPct(row.budget_usage)}</td>
    </tr>
  );
}

function DoGroup({ doName, rows, showDone }: { doName: string; rows: SchedStatusRow[]; showDone: boolean }) {
  const visible = showDone ? rows : rows.filter((r) => (r.status_step ?? 0) < 4);
  if (!visible.length) return null;
  const pct = Math.round((rows.filter((r) => (r.status_step ?? 0) >= 4).length / rows.length) * 100);
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">{doName}</h3>
        <span className="text-xs text-zinc-500">{pct}% complete · {rows.length} stores</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed min-w-[560px]">
          <colgroup>
            <col className="w-14" />    {/* Store # */}
            <col />                      {/* Name — takes remaining space */}
            <col className="w-44" />    {/* Status pill */}
            <col className="w-28" />    {/* Adj Forecast */}
            <col className="w-20" />    {/* Sched % */}
            <col className="w-20" />    {/* Target % */}
            <col className="w-20" />    {/* Budget Usage */}
          </colgroup>
          <thead>
            <tr className="text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-700">
              <th className="pb-1 pr-3 text-left font-medium">Store</th>
              <th className="pb-1 pr-3 text-left font-medium">Name</th>
              <th className="pb-1 pr-3 text-left font-medium">Status</th>
              <th className="pb-1 pr-3 text-right font-medium">Adj Forecast</th>
              <th className="pb-1 pr-3 text-right font-medium">Sched %</th>
              <th className="pb-1 pr-3 text-right font-medium">Target %</th>
              <th className="pb-1 text-right font-medium">Budget</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => <StoreRow key={r.store_number} row={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ScheduleStatusPage() {
  const [week, setWeek] = useState("");
  const [rvpFilter, setRvpFilter] = useState("all");
  const [showDone, setShowDone] = useState(false);

  const weeksQ = useQuery({
    queryKey: ["sched-status-weeks"],
    queryFn: fetchSchedWeeks,
    staleTime: 10 * 60_000,
  });

  const availableWeek = week || weeksQ.data?.weeks?.[0] || "";

  const summaryQ = useQuery({
    queryKey: ["sched-status-summary", availableWeek],
    queryFn: () => fetchSchedSummary(availableWeek),
    enabled: !!availableWeek,
    staleTime: 5 * 60_000,
  });

  const data = summaryQ.data;

  const rvpOptions = useMemo(() => {
    if (!data?.rows) return [];
    const set = new Set(data.rows.map((r) => r.region ?? r.rvp ?? "").filter(Boolean));
    return [...set].sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    if (rvpFilter === "all") return data.rows;
    return data.rows.filter((r) => (r.region ?? r.rvp ?? "") === rvpFilter);
  }, [data, rvpFilter]);

  const byDo = useMemo(() => {
    const map = new Map<string, SchedStatusRow[]>();
    for (const r of filteredRows) {
      const key = r.do_name_org ?? r.do_name ?? "Unknown DO";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    // sort by % incomplete desc (most behind first)
    return [...map.entries()].sort(([, a], [, b]) => {
      const pctA = a.filter((r) => (r.status_step ?? 0) < 4).length / a.length;
      const pctB = b.filter((r) => (r.status_step ?? 0) < 4).length / b.length;
      return pctB - pctA;
    });
  }, [filteredRows]);

  const isLoading = weeksQ.isLoading || summaryQ.isLoading;
  const isError = weeksQ.isError || summaryQ.isError;

  const incompletePct = data
    ? Math.round(((data.stepCounts[1] + data.stepCounts[2] + data.stepCounts[3]) / (data.total || 1)) * 100)
    : null;

  return (
    <>
      <PageHeader
        title="Schedule Status"
        description="ExpressWay schedule workflow progress by store."
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">Week of</label>
          <select
            className="rounded-md border border-zinc-300 bg-white dark:bg-zinc-800 dark:border-zinc-700 px-3 py-1.5 text-sm"
            value={availableWeek}
            onChange={(e) => setWeek(e.target.value)}
          >
            {weeksQ.isLoading && <option>Loading…</option>}
            {(weeksQ.data?.weeks ?? []).map((w) => (
              <option key={w} value={w}>{fmtDate(w)}</option>
            ))}
          </select>
        </div>

        {rvpOptions.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Region</label>
            <select
              className="rounded-md border border-zinc-300 bg-white dark:bg-zinc-800 dark:border-zinc-700 px-3 py-1.5 text-sm"
              value={rvpFilter}
              onChange={(e) => setRvpFilter(e.target.value)}
            >
              <option value="all">All Regions</option>
              {rvpOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
          <input
            type="checkbox"
            className="accent-emerald-600"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Show Approved/Published stores
        </label>

        {summaryQ.isFetching && (
          <RefreshCw className="w-4 h-4 text-zinc-400 animate-spin" />
        )}
      </div>

      {/* Step counts */}
      {isLoading && (
        <Card className="mb-5"><CardBody><Skeleton className="h-16 w-full" /></CardBody></Card>
      )}
      {data && !isLoading && (
        <Card className="mb-5">
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <StepBar counts={data.stepCounts} total={data.total} />
              {incompletePct != null && (
                <div className="text-right">
                  <p className="text-3xl font-bold">{100 - incompletePct}%</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Approved or Published</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <EmptyState
          title="Couldn't load schedule data"
          description={(summaryQ.error as Error)?.message ?? "Try refreshing the page."}
        />
      )}

      {/* No data yet */}
      {!isLoading && !isError && data && data.total === 0 && (
        <EmptyState
          title="No data for this week"
          description="Run 'ew sched-status --load' on the MacBook to populate schedule data."
        />
      )}

      {/* Grouped by DO */}
      {!isLoading && byDo.length > 0 && (
        <div>
          {byDo.map(([doName, rows]) => (
            <Card key={doName} className="mb-4">
              <CardBody>
                <DoGroup doName={doName} rows={rows} showDone={showDone} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
