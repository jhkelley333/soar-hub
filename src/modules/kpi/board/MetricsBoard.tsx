// Execution Metrics Board — the site-themed board (light cards, PageHeader,
// accent controls) matching the rest of the app. Phase 1 shows the Sales pillar
// ("Goals to Grow Sales"): a Metric-That-Matters hero (Sales vs. LY) plus its
// execution metrics, with a Daily/WTD/MTD toggle, sparklines, and a trailing
// 5-week strip. Scope-selectable (company / region / store). Live values come
// from kpi-board; targets/units from the static catalog. VOG is sourced from
// the current ranker; unwired metrics render "—".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { PILLARS, type MetricDef, type Pillar } from "./catalog";
import { fetchKpiBoard, type MetricValues } from "./api";
import { metricView, PERIOD_LABELS, type DeltaTone, type MetricView, type Period, type StatusTone } from "./logic";

const STATUS_BORDER: Record<StatusTone, string> = {
  good: "border-l-emerald-500", warn: "border-l-amber-500", bad: "border-l-red-500", none: "border-l-zinc-200",
};
const STATUS_STROKE: Record<StatusTone, string> = {
  good: "#059669", warn: "#d97706", bad: "#dc2626", none: "#a1a1aa",
};
const DELTA_TEXT: Record<DeltaTone, string> = { good: "text-emerald-600", bad: "text-red-600", flat: "text-zinc-400" };

function Sparkline({ v, w, h, sw, r }: { v: MetricView; w: number; h: number; sw: number; r: number }) {
  if (!v.spark) return <svg width={w} height={h} className="block" />;
  const stroke = STATUS_STROKE[v.statusTone];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block">
      <path d={v.spark} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={v.dotX} cy={v.dotY} r={r} fill={stroke} />
    </svg>
  );
}

function WeekStrip({ v }: { v: MetricView }) {
  if (!v.weeks.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {v.weeks.map((w) => (
        <div key={w.label} className="flex flex-col">
          <span className="text-[9.5px] font-semibold uppercase tracking-wide text-zinc-400">{w.label}</span>
          <span className="text-[11px] tabular-nums text-zinc-600">{w.value}</span>
        </div>
      ))}
    </div>
  );
}

// The Metric That Matters hero card.
function MtmHero({ v }: { v: MetricView }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-accent/[0.06] to-transparent p-5 ring-1 ring-zinc-200">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-accent">Metric That Matters</div>
      <div className="mt-1 text-sm text-zinc-500">{v.name}</div>
      <div className="mt-2 flex items-end gap-2.5">
        <span className={cn("text-5xl font-bold leading-none tracking-tight tabular-nums", v.hasData ? "text-midnight" : "text-zinc-300")}>{v.value}</span>
        {v.delta && <span className={cn("pb-1 text-sm font-semibold tabular-nums", DELTA_TEXT[v.deltaTone])}>{v.delta}</span>}
      </div>
      <div className="mt-1.5 text-xs text-zinc-400">{v.targetLabel}</div>
      <div className="mt-3">
        <Sparkline v={v} w={280} h={48} sw={2} r={3} />
      </div>
      {v.weeks.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <WeekStrip v={v} />
        </div>
      )}
    </div>
  );
}

function ExecCard({ def, v }: { def: MetricDef; v: MetricView }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-lg border border-l-2 border-zinc-200 bg-white px-3.5 py-3", STATUS_BORDER[v.statusTone])}>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-midnight">{def.name}</div>
        <div className="text-[11px] text-zinc-400">{v.targetLabel}</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden sm:block"><Sparkline v={v} w={92} h={26} sw={1.5} r={2} /></div>
        <div className="flex flex-col items-end">
          <span className={cn("text-base font-semibold tabular-nums", v.hasData ? "text-midnight" : "text-zinc-300")}>{v.value}</span>
          {v.delta && <span className={cn("text-[11px] tabular-nums", DELTA_TEXT[v.deltaTone])}>{v.delta}</span>}
        </div>
      </div>
    </div>
  );
}

function PillarCard({ p, values, period }: { p: Pillar; values: Record<string, MetricValues>; period: Period }) {
  const mtmV = metricView(p.mtm, values[p.mtm.id], period, 280, 48);
  const rowViews = p.rows.map((r) => ({ def: r, v: metricView(r, values[r.id], period, 92, 26) }));
  return (
    <section className="overflow-hidden rounded-xl bg-white p-5 ring-1 ring-zinc-200 sm:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-sm font-semibold text-accent">{p.index}</span>
          <h2 className="text-lg font-bold tracking-tight text-midnight">{p.title}</h2>
        </div>
        {p.countLabel && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">{p.countLabel}</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <MtmHero v={mtmV} />
        <div className="grid content-start gap-2.5 sm:grid-cols-2">
          {rowViews.map(({ def, v }) => <ExecCard key={def.id} def={def} v={v} />)}
        </div>
      </div>
    </section>
  );
}

const selCls = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none";

export function MetricsBoard() {
  const [period, setPeriod] = useState<Period>("wtd");
  const [level, setLevel] = useState<"company" | "region" | "store">("company");
  const [id, setId] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["kpi-board", level, id], queryFn: () => fetchKpiBoard(level, id) });
  const data = q.data;
  const values = data?.values ?? {};

  // On-target counter across every metric (MTMs included).
  let total = 0, good = 0;
  for (const p of PILLARS) for (const m of [p.mtm, ...p.rows]) {
    const v = metricView(m, values[m.id], period, 10, 10);
    if (v.hasData) { total++; if (v.onTarget) good++; }
  }

  const per = PERIOD_LABELS[period];
  const dateLabel = data?.anchor ? new Date(`${data.anchor}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "—";
  const fiscalLabel = data?.fiscal ? `Period ${data.fiscal.period}, Week ${data.fiscal.weekInPeriod}` : "";

  return (
    <>
      <PageHeader
        title="Execution Metrics Board"
        description={data?.anchor ? `${dateLabel}${fiscalLabel ? ` · ${fiscalLabel}` : ""} · comparison: ${per.compare}` : "Metrics That Matter — sales, service, and speed."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={level} onChange={(e) => { setLevel(e.target.value as typeof level); setId(null); }} className={selCls}>
              <option value="company">Company</option>
              <option value="region">Region</option>
              <option value="store">Store</option>
            </select>
            {level === "region" && (
              <select value={id ?? ""} onChange={(e) => setId(e.target.value || null)} className={selCls}>
                <option value="">All regions…</option>
                {(data?.scopes.regions ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            {level === "store" && (
              <select value={id ?? ""} onChange={(e) => setId(e.target.value || null)} className={selCls}>
                <option value="">Pick a store…</option>
                {(data?.scopes.stores ?? []).map((s) => <option key={s.number} value={s.number}>#{s.number} · {s.name}</option>)}
              </select>
            )}
            <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-zinc-200">
              {(["daily", "wtd", "mtd"] as Period[]).map((pk) => (
                <button
                  key={pk}
                  type="button"
                  onClick={() => setPeriod(pk)}
                  className={cn("px-3 py-1.5 text-sm font-semibold transition", period === pk ? "bg-accent text-white" : "bg-white text-zinc-600 hover:bg-zinc-50")}
                >
                  {pk === "daily" ? "Daily" : pk === "wtd" ? "WTD" : "MTD"}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {q.isLoading && <Skeleton className="h-96 w-full" />}
      {q.isError && <EmptyState title="Couldn't load the board" description={(q.error as Error)?.message ?? "Try again."} />}
      {data && data.anchor == null && <EmptyState title="No data yet" description="No labor snapshot has been captured." />}

      {data && data.anchor && (
        <div className="space-y-4">
          {/* On-target summary + legend */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-zinc-200">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold tabular-nums text-midnight">{good}/{total}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Metrics on target</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[11.5px] text-zinc-500">
              {([["bg-emerald-500", "On / above target"], ["bg-amber-500", "Within 5%"], ["bg-red-500", "Off target"]] as const).map(([sw, label]) => (
                <span key={label} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-sm", sw)} />{label}</span>
              ))}
              <span className="hidden sm:inline">Sparkline = trailing 5 weeks · Δ vs {per.compare}</span>
            </div>
          </div>

          {PILLARS.map((p) => <PillarCard key={p.key} p={p} values={values} period={period} />)}
        </div>
      )}
    </>
  );
}
