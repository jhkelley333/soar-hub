// Schedule Status — per-store ExpressWay schedule workflow state.
// Visible to DOs and above. Shows step counts + stores not yet Approved/Published
// grouped by DO, filterable by RVP/region.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, RefreshCw, X } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchSchedWeeks, fetchSchedSummary, fetchSchedHistory } from "./api";
import { STEP_LABELS } from "./types";
import type { SchedStatusRow, SchedHistoryDay, StepCounts } from "./types";

const fmtPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtDate = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-semibold mb-1">About Schedule Status</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">Updated daily · all 272 stores</p>

        <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          <p>
            This screen shows where every store stands on building their schedule for the coming week in ExpressWay.
            Status is refreshed each morning so you always have an up-to-date picture across your entire organization.
          </p>

          <div>
            <p className="font-medium mb-2">Schedules move through five stages:</p>
            <ol className="space-y-1.5">
              {([
                ["No Shift Started", "No scheduling work has begun yet."],
                ["Draft", "A schedule is being built but hasn't been submitted."],
                ["Submitted", "The GM has submitted the schedule for the DO's review."],
                ["Approved", "The DO has reviewed and approved the schedule."],
                ["Published", "The schedule is live — employees can see their shifts."],
              ] as [string, string][]).map(([label, desc], i) => (
                <li key={i} className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span><strong>{label}</strong> — {desc}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="font-medium mb-1">What the History tab shows</p>
            <p>
              A day-by-day breakdown of how the week came together — how many stores were at each stage on Monday,
              Tuesday, and so on. Over time this shows which districts build schedules early and which tend to wait
              until the last minute.
            </p>
          </div>

          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-3">
            <p className="font-medium mb-1">What's tracked and when</p>
            <p>
              Status is captured once each morning for the upcoming week. Each week's record is complete by the
              Sunday before it starts. Once a week is underway, its snapshot is frozen — mid-week edits to a
              published schedule are not reflected here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Colors matched to step pills — same hue family, chart-safe hex values
const STEP_COLORS: Record<number, string> = {
  1: "#a1a1aa", // zinc-400 — No Shift Started
  2: "#f59e0b", // amber-400 — Draft
  3: "#38bdf8", // sky-400 — Submitted
  4: "#34d399", // emerald-400 — Approved
  5: "#059669", // emerald-600 — Published (deeper so it reads distinct from Approved)
};

function HistoryChart({ days }: { days: SchedHistoryDay[] }) {
  const chartData = days.map((d) => ({
    date: new Date(`${d.checked_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    "No Shift Started": d.stepCounts[1],
    "Draft": d.stepCounts[2],
    "Submitted": d.stepCounts[3],
    "Approved": d.stepCounts[4],
    "Published": d.stepCounts[5],
  }));

  const steps = [
    { key: "No Shift Started", color: STEP_COLORS[1] },
    { key: "Draft",            color: STEP_COLORS[2] },
    { key: "Submitted",        color: STEP_COLORS[3] },
    { key: "Approved",         color: STEP_COLORS[4] },
    { key: "Published",        color: STEP_COLORS[5] },
  ];

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "currentColor" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "currentColor" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid #e4e4e7",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
        {steps.map((s) => (
          <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={s.key === "Published" ? [3, 3, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function HistoryView({ days }: { days: SchedHistoryDay[] }) {
  if (!days.length) {
    return (
      <Card>
        <CardBody>
          <div className="py-10 text-center text-sm text-zinc-400">
            No history yet — check back after the next morning update.
          </div>
        </CardBody>
      </Card>
    );
  }
  const fmtDay = (s: string) =>
    new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const colCls = "px-3 py-2 text-right tabular-nums text-sm";
  const hCls = "px-3 pb-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wide";

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <HistoryChart days={days} />
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed min-w-[520px]">
              <colgroup>
                <col className="w-36" />
                <col className="w-28" />
                <col className="w-20" />
                <col className="w-24" />
                <col className="w-20" />
                <col className="w-24" />
              </colgroup>
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="pb-2 pr-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Date</th>
                  <th className={hCls}>No Shift Started</th>
                  <th className={hCls}>Draft</th>
                  <th className={hCls}>Submitted</th>
                  <th className={hCls}>Approved</th>
                  <th className={hCls}>Published</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const done = d.stepCounts[4] + d.stepCounts[5];
                  const pct = d.total ? Math.round((done / d.total) * 100) : 0;
                  return (
                    <tr key={d.checked_date} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-3 text-sm font-medium">
                        {fmtDay(d.checked_date)}
                        <span className="ml-2 text-xs text-zinc-400">{pct}%</span>
                      </td>
                      <td className={cn(colCls, d.stepCounts[1] > 0 ? "text-zinc-500" : "text-zinc-300 dark:text-zinc-600")}>{d.stepCounts[1]}</td>
                      <td className={cn(colCls, d.stepCounts[2] > 0 ? "text-amber-600 dark:text-amber-400" : "text-zinc-300 dark:text-zinc-600")}>{d.stepCounts[2]}</td>
                      <td className={cn(colCls, d.stepCounts[3] > 0 ? "text-sky-600 dark:text-sky-400" : "text-zinc-300 dark:text-zinc-600")}>{d.stepCounts[3]}</td>
                      <td className={cn(colCls, d.stepCounts[4] > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-300 dark:text-zinc-600")}>{d.stepCounts[4]}</td>
                      <td className={cn(colCls, d.stepCounts[5] > 0 ? "text-emerald-700 dark:text-emerald-300 font-medium" : "text-zinc-300 dark:text-zinc-600")}>{d.stepCounts[5]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

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
  const [showInfo, setShowInfo] = useState(false);
  const [tab, setTab] = useState<"stores" | "history">("stores");

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

  const historyQ = useQuery({
    queryKey: ["sched-status-history", availableWeek],
    queryFn: () => fetchSchedHistory(availableWeek),
    enabled: !!availableWeek && tab === "history",
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

  // Past weeks (already started) always show all stores — the toggle only helps for the upcoming week
  const isPastWeek = !!availableWeek && availableWeek <= new Date().toISOString().slice(0, 10);

  const lastUpdated = useMemo(() => {
    if (!data?.rows?.length) return null;
    const max = data.rows.reduce((best, r) => (r.pulled_at && r.pulled_at > best ? r.pulled_at : best), "");
    return max ? fmtDateTime(max) : null;
  }, [data]);

  return (
    <>
      <div className="flex items-start justify-between gap-2 mb-1">
        <PageHeader
          title="Schedule Status"
          description="ExpressWay schedule workflow progress by store."
        />
        <button
          onClick={() => setShowInfo(true)}
          className="mt-1 flex-shrink-0 rounded-full p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          title="How this works"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>
      {lastUpdated && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 -mt-3 mb-4">Last updated {lastUpdated}</p>
      )}
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}

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

        {!isPastWeek && tab === "stores" && (
          <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
            <input
              type="checkbox"
              className="accent-emerald-600"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            Show Approved/Published stores
          </label>
        )}

        {(summaryQ.isFetching || historyQ.isFetching) && (
          <RefreshCw className="w-4 h-4 text-zinc-400 animate-spin ml-auto" />
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-5 border-b border-zinc-200 dark:border-zinc-700">
        {(["stores", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors",
              tab === t
                ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            {t === "stores" ? "By Store" : "History"}
          </button>
        ))}
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
          description="Schedule data is refreshed each morning. Check back after the next update."
        />
      )}

      {/* By Store tab */}
      {tab === "stores" && !isLoading && byDo.length > 0 && (
        <div>
          {byDo.map(([doName, rows]) => (
            <Card key={doName} className="mb-4">
              <CardBody>
                <DoGroup doName={doName} rows={rows} showDone={isPastWeek || showDone} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* History tab */}
      {tab === "history" && (
        historyQ.isLoading
          ? <Card><CardBody><Skeleton className="h-40 w-full" /></CardBody></Card>
          : <HistoryView days={historyQ.data?.days ?? []} />
      )}
    </>
  );
}
