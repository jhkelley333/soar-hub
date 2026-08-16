// Dashboard — "Metrics That Matter" band. Pulls the five pillar headline
// metrics (Sales vs LY, L2R, Labor %, COGS Eff, Controllable Cost %) to the
// very top of the dashboard so the numbers are the first thing leadership
// sees. Reuses the Execution Metrics Board's data + logic (fetchKpiBoard,
// metricView, PILLARS) but renders in the dashboard's dark-aware card style.
// Company scope; Daily/WTD/MTD toggle; an ⓘ explains where each number comes
// from; "Full board →" drills into the scoped board. Only rendered for
// board-eligible roles (do+) — GMs would 403 the endpoint.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Info } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { cn } from "@/lib/cn";
import { fiscalInfo } from "@/lib/fiscal";
import { PILLARS } from "@/modules/kpi/board/catalog";
import { fetchKpiBoard } from "@/modules/kpi/board/api";
import { metricView, spark, PERIOD_LABELS, type Period, type StatusTone } from "@/modules/kpi/board/logic";

const PANEL =
  "rounded-2xl border border-zinc-200 bg-white shadow-card dark:border-night-line dark:bg-night-raised dark:shadow-none";

const STATUS_BAR: Record<StatusTone, string> = {
  good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", none: "bg-zinc-300 dark:bg-night-line",
};
const STATUS_PILL: Record<StatusTone, string> = {
  good: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  bad: "bg-red-500/10 text-red-600 dark:text-red-400",
  none: "bg-zinc-400/10 text-ink-subtle dark:text-night-muted",
};
const STATUS_LABEL: Record<StatusTone, string> = {
  good: "On target", warn: "Within 5%", bad: "Off target", none: "No target",
};
const STATUS_STROKE: Record<StatusTone, string> = {
  good: "#10b981", warn: "#f59e0b", bad: "#ef4444", none: "#94a3b8",
};
const DELTA_TEXT: Record<string, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-red-600 dark:text-red-400",
  flat: "text-ink-subtle dark:text-night-muted",
};

const money0 = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);

// Where each headline number comes from — shown in the ⓘ modal.
const SOURCES: { name: string; source: string }[] = [
  { name: "Sales vs. LY", source: "KPI feed (Skunkworks) — net sales vs. the same period last year." },
  { name: "Likely to Return (L2R)", source: "Last-week ranker — Likely-to-Return top-box, response-weighted across the scope." },
  { name: "Labor % vs. Target", source: "Daily labor report — actual labor % measured against the feed's target." },
  { name: "COGS Efficiency", source: "Last-week ranker — COGS efficiency; healthy inside the 96–101% band." },
  { name: "Controllable Cost % of Sales", source: "Blend: Food Cost % (IX upload / ranker) + period-to-date Labor % (daily) + Cash-short %." },
];

function SparkArea({ points, tone, w = 240, h = 40 }: { points: number[]; tone: StatusTone; w?: number; h?: number }) {
  const gid = useMemo(() => `mtm-${Math.random().toString(36).slice(2)}`, []);
  if (points.length < 2) return <svg width={w} height={h} className="block w-full" viewBox={`0 0 ${w} ${h}`} />;
  const s = spark(points, w, h);
  const stroke = STATUS_STROKE[tone];
  const area = `${s.d} L${s.x} ${h} L3 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={s.d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={s.x} cy={s.y} r={3} fill={stroke} />
    </svg>
  );
}

export function MetricsThatMatter() {
  const [period, setPeriod] = useState<Period>("wtd");
  const [infoOpen, setInfoOpen] = useState(false);

  const q = useQuery({
    queryKey: ["kpi-board", "company", null, ""],
    queryFn: () => fetchKpiBoard("company", null, null),
    staleTime: 3 * 60_000,
    refetchOnWindowFocus: false,
  });
  const data = q.data;
  const values = data?.values ?? {};
  const targets = data?.targets ?? {};
  const nowFw = data?.anchor ? fiscalInfo(new Date(`${data.anchor}T12:00:00`))?.fiscalWeek ?? null : null;

  // On-target tally across the five headline metrics.
  const { good, total } = useMemo(() => {
    let good = 0, total = 0;
    for (const p of PILLARS) {
      const v = metricView(p.mtm, values[p.mtm.id], period, 10, 10, targets[p.mtm.id], nowFw);
      if (v.hasData) { total++; if (v.onTarget) good++; }
    }
    return { good, total };
  }, [values, targets, period, nowFw]);

  const per = PERIOD_LABELS[period];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-ink dark:text-night-ink">Metrics That Matter</h2>
          {total > 0 && (
            <span className="inline-flex items-baseline gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5">
              <span className="text-sm font-bold tabular-nums text-accent">{good}/{total}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-accent/80">on target</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-subtle transition hover:bg-zinc-100 hover:text-accent dark:hover:bg-white/10"
            aria-label="Where these numbers come from"
            title="Where these numbers come from"
          >
            <Info className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-night-line">
            {(["daily", "wtd", "mtd"] as Period[]).map((pk) => (
              <button
                key={pk}
                type="button"
                onClick={() => setPeriod(pk)}
                className={cn(
                  "px-3 py-1.5 text-[13px] font-semibold transition",
                  period === pk
                    ? "bg-accent text-white"
                    : "bg-white text-ink-muted hover:bg-zinc-50 dark:bg-night-raised dark:text-night-muted dark:hover:bg-white/5",
                )}
              >
                {pk === "daily" ? "Daily" : pk === "wtd" ? "WTD" : "MTD"}
              </button>
            ))}
          </div>
          <Link to="/admin/metrics-board" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
            Full board <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((p) => <div key={p.key} className={cn(PANEL, "h-52 animate-pulse")} />)}
        </div>
      ) : q.isError ? (
        <div className={cn(PANEL, "p-5 text-sm text-cherry")}>Couldn't load the metrics board.</div>
      ) : !data?.anchor ? (
        <div className={cn(PANEL, "p-5 text-sm text-ink-muted dark:text-night-muted")}>No metrics captured yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((p) => {
            const v = metricView(p.mtm, values[p.mtm.id], period, 240, 40, targets[p.mtm.id], nowFw);
            const weeksRaw = (values[p.mtm.id]?.weeks ?? []).filter((n): n is number => typeof n === "number");

            // Sales pillar: show the actual $ (and $ vs LY) under the headline.
            let sub: string | null = null;
            if (p.key === "sales") {
              const sd = values.sales_dollars?.[period]?.[0] ?? null;
              const ld = values.ly_dollars?.[period]?.[0] ?? null;
              if (sd != null) {
                const d = ld != null ? sd - ld : null;
                sub = `${money0(sd)}${d != null ? ` · ${d >= 0 ? "+" : "−"}${money0(Math.abs(d))} vs LY` : ""}`;
              }
            }

            return (
              <div key={p.key} className={cn(PANEL, "relative overflow-hidden p-4")}>
                <div className={cn("absolute inset-x-0 top-0 h-1", STATUS_BAR[v.statusTone])} />
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-accent">Metric That Matters</span>
                  {v.hasData && (
                    <span className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide", STATUS_PILL[v.statusTone])}>
                      {p.key === "cogs" && v.statusTone === "good" ? "In band" : STATUS_LABEL[v.statusTone]}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-[13px] font-medium text-ink-muted dark:text-night-muted">{v.name}</div>
                <div className="mt-1 flex items-end gap-2">
                  <span className={cn("text-4xl font-bold leading-none tracking-tight tabular-nums", v.hasData ? "text-ink dark:text-night-ink" : "text-zinc-300 dark:text-night-line")}>
                    {v.value}
                  </span>
                  {v.delta && <span className={cn("pb-0.5 text-xs font-bold tabular-nums", DELTA_TEXT[v.deltaTone])}>{v.delta}</span>}
                </div>
                <div className="mt-1 min-h-[16px] text-[12px] font-semibold tabular-nums text-ink dark:text-night-ink">{sub}</div>
                <div className="text-[11px] text-ink-subtle dark:text-night-muted">{v.targetLabel}</div>
                <div className="mt-2">
                  <SparkArea points={weeksRaw} tone={v.statusTone} />
                </div>
                {v.weeks.length > 0 && (
                  <div className="mt-2 flex justify-between gap-1 border-t border-zinc-100 pt-2 dark:border-night-line">
                    {v.weeks.map((w, i) => (
                      <div key={w.label} className="flex flex-col items-center gap-0.5">
                        <span className="text-[8.5px] font-bold uppercase tracking-wide text-ink-subtle dark:text-night-muted">{w.label}</span>
                        <span className={cn("text-[11px] tabular-nums", i === v.weeks.length - 1 ? "font-bold text-ink dark:text-night-ink" : "text-ink-muted dark:text-night-muted")}>{w.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {data?.anchor && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted dark:text-night-muted">
          {([["bg-emerald-500", "On / above target"], ["bg-amber-500", "Within 5%"], ["bg-red-500", "Off target"]] as const).map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-sm", c)} />{l}</span>
          ))}
          <span className="text-ink-subtle dark:text-night-muted/70">Sparkline = trailing 5 weeks · Δ vs {per.compare.toLowerCase()} · company-wide</span>
        </div>
      )}

      {infoOpen && (
        <Modal open onClose={() => setInfoOpen(false)} title="Where these numbers come from">
          <p className="mb-3 text-xs text-ink-muted dark:text-night-muted">
            The five headline metrics are company-wide and refresh every few minutes. Each pillar's full execution
            metrics, targets, and per-store drill-downs live on the Execution Metrics Board.
          </p>
          <div className="space-y-2.5">
            {SOURCES.map((s) => (
              <div key={s.name} className="rounded-lg bg-zinc-50 p-3 dark:bg-white/5">
                <div className="text-sm font-semibold text-ink dark:text-night-ink">{s.name}</div>
                <div className="mt-0.5 text-[12.5px] text-ink-muted dark:text-night-muted">{s.source}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-subtle dark:text-night-muted">
            Comparison depends on the period: WTD vs. the same period last week, MTD vs. last month, Daily vs. yesterday.
          </p>
        </Modal>
      )}
    </section>
  );
}
