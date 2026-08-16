// Dashboard — "Metrics That Matter" band. Pulls the five pillar headline
// metrics (Sales vs LY, L2R, Labor %, COGS Eff, Controllable Cost %) to the
// very top of the dashboard so the numbers are the first thing leadership
// sees. Scoped to the viewer: a DO/SDO/RVP sees THEIR stores (level=mine);
// org-wide roles (admin/vp/coo) see the whole company. Click a tile to flip
// it — the back shows how the scope is doing vs. Company plus that pillar's
// execution metrics. Reuses the Execution Metrics Board's data + logic; the
// ⓘ explains where each number comes from. Board-eligible roles only (do+).

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Info, RotateCw } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { useAuth } from "@/auth/AuthProvider";
import { useEffectiveRole } from "@/lib/useViewAs";
import { cn } from "@/lib/cn";
import { fiscalInfo } from "@/lib/fiscal";
import { PILLARS, type Pillar } from "@/modules/kpi/board/catalog";
import { fetchKpiBoard, type MetricValues } from "@/modules/kpi/board/api";
import { metricView, spark, deltaOf, PERIOD_LABELS, type Period, type StatusTone } from "@/modules/kpi/board/logic";

const PANEL =
  "rounded-2xl border border-zinc-200 bg-white shadow-card dark:border-night-line dark:bg-night-raised dark:shadow-none";

const ORG_WIDE = new Set(["admin", "vp", "coo"]);

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
const rawCur = (v: MetricValues | undefined, per: Period) => (v?.[per]?.[0] ?? null);

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

// A single flippable pillar tile. Front = the headline metric; back = vs
// Company + that pillar's execution metrics for the current scope.
function MtmTile({ pillar, scoped, company, targets, period, nowFw, orgWide }: {
  pillar: Pillar;
  scoped: Record<string, MetricValues>;
  company: Record<string, MetricValues> | null;
  targets: Record<string, number>;
  period: Period;
  nowFw: number | null;
  orgWide: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const mtm = pillar.mtm;
  const v = metricView(mtm, scoped[mtm.id], period, 240, 40, targets[mtm.id], nowFw);
  const weeksRaw = (scoped[mtm.id]?.weeks ?? []).filter((n): n is number => typeof n === "number");

  // Sales pillar: show the actual $ (and $ vs LY) under the headline.
  let sub: string | null = null;
  if (pillar.key === "sales") {
    const sd = rawCur(scoped.sales_dollars, period);
    const ld = rawCur(scoped.ly_dollars, period);
    if (sd != null) {
      const d = ld != null ? sd - ld : null;
      sub = `${money0(sd)}${d != null ? ` · ${d >= 0 ? "+" : "−"}${money0(Math.abs(d))} vs LY` : ""}`;
    }
  }

  // vs-Company chip for a metric (scoped roles only).
  function vsCo(def: typeof mtm) {
    if (!company) return null;
    const mine = rawCur(scoped[def.id], period);
    const co = rawCur(company[def.id], period);
    if (mine == null || co == null) return null;
    const d = deltaOf(def, mine, co);
    return d;
  }

  const flipLabel = orgWide ? "Execution metrics" : "You vs. Company";

  return (
    <div className="[perspective:1200px]">
      <div
        className={cn("relative h-[300px] transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none", flipped && "[transform:rotateY(180deg)]")}
      >
        {/* FRONT */}
        <button
          type="button"
          onClick={() => setFlipped(true)}
          className={cn(PANEL, "absolute inset-0 flex flex-col overflow-hidden p-4 text-left [backface-visibility:hidden]")}
          aria-label={`${v.name}. Flip for ${flipLabel.toLowerCase()}`}
        >
          <div className={cn("absolute inset-x-0 top-0 h-1", STATUS_BAR[v.statusTone])} />
          <div className="flex items-center justify-between">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-accent">Metric That Matters</span>
            {v.hasData && (
              <span className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide", STATUS_PILL[v.statusTone])}>
                {pillar.key === "cogs" && v.statusTone === "good" ? "In band" : STATUS_LABEL[v.statusTone]}
              </span>
            )}
          </div>
          <div className="mt-2 text-[13px] font-medium text-ink-muted dark:text-night-muted">{v.name}</div>
          <div className="mt-1 flex items-end gap-2">
            <span className={cn("text-4xl font-bold leading-none tracking-tight tabular-nums", v.hasData ? "text-ink dark:text-night-ink" : "text-zinc-300 dark:text-night-line")}>{v.value}</span>
            {v.delta && <span className={cn("pb-0.5 text-xs font-bold tabular-nums", DELTA_TEXT[v.deltaTone])}>{v.delta}</span>}
          </div>
          <div className="mt-1 min-h-[16px] text-[12px] font-semibold tabular-nums text-ink dark:text-night-ink">{sub}</div>
          <div className="text-[11px] text-ink-subtle dark:text-night-muted">{v.targetLabel}</div>
          <div className="mt-2"><SparkArea points={weeksRaw} tone={v.statusTone} /></div>
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
          <div className="mt-auto flex items-center justify-end gap-1 pt-2 text-[10.5px] font-semibold text-ink-subtle dark:text-night-muted">
            <RotateCw className="h-3 w-3" strokeWidth={2.2} /> {flipLabel}
          </div>
        </button>

        {/* BACK */}
        <div className={cn(PANEL, "absolute inset-0 flex flex-col overflow-hidden p-4 [transform:rotateY(180deg)] [backface-visibility:hidden]")}>
          <div className="flex items-center justify-between">
            <span className="truncate text-[12px] font-bold text-ink dark:text-night-ink">{pillar.title}</span>
            <button type="button" onClick={() => setFlipped(false)} className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-accent hover:underline" aria-label="Flip back">
              <RotateCw className="h-3 w-3" strokeWidth={2.2} /> Back
            </button>
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle dark:text-night-muted">
            {orgWide ? "Execution metrics · vs prior" : "Value · vs Company"}
          </div>

          <div className="mt-1.5 flex-1 space-y-0.5 overflow-y-auto">
            {[mtm, ...pillar.rows].filter((d) => !d.soon).map((def, i) => {
              const mv = metricView(def, scoped[def.id], period, 10, 10, targets[def.id], nowFw);
              const cmp = orgWide ? null : vsCo(def);
              const chip = orgWide ? mv.delta : cmp?.text ?? "";
              const chipTone = orgWide ? mv.deltaTone : (cmp?.tone ?? "flat");
              return (
                <div key={def.id} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1", i === 0 && "bg-accent/[0.06]")}>
                  <span className={cn("min-w-0 flex-1 truncate text-[12px]", i === 0 ? "font-bold text-ink dark:text-night-ink" : "text-ink-muted dark:text-night-muted")}>{def.name}</span>
                  <span className={cn("shrink-0 text-[12px] font-semibold tabular-nums", mv.hasData ? "text-ink dark:text-night-ink" : "text-zinc-300 dark:text-night-line")}>{mv.value}</span>
                  <span className={cn("w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums", DELTA_TEXT[chipTone])}>{chip}</span>
                </div>
              );
            })}
          </div>
          <Link to="/admin/metrics-board" className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
            Full board <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export function MetricsThatMatter() {
  const { profile } = useAuth();
  const role = useEffectiveRole(profile);
  const orgWide = !!role && ORG_WIDE.has(role);
  const scopeLevel = orgWide ? "company" : "mine";

  const [period, setPeriod] = useState<Period>("wtd");
  const [infoOpen, setInfoOpen] = useState(false);

  const scopedQ = useQuery({
    queryKey: ["kpi-board", scopeLevel, null, ""],
    queryFn: () => fetchKpiBoard(scopeLevel, null, null),
    staleTime: 3 * 60_000,
    refetchOnWindowFocus: false,
  });
  // Company baseline for the "vs Company" flip — scoped roles only (org-wide
  // roles already ARE the company).
  const companyQ = useQuery({
    queryKey: ["kpi-board", "company", null, ""],
    queryFn: () => fetchKpiBoard("company", null, null),
    staleTime: 3 * 60_000,
    refetchOnWindowFocus: false,
    enabled: !orgWide,
  });

  const data = scopedQ.data;
  const values = data?.values ?? {};
  const targets = data?.targets ?? {};
  const companyValues = orgWide ? null : companyQ.data?.values ?? null;
  const nowFw = data?.anchor ? fiscalInfo(new Date(`${data.anchor}T12:00:00`))?.fiscalWeek ?? null : null;
  const storeCount = data?.scope?.storeCount ?? null;

  const { good, total } = useMemo(() => {
    let good = 0, total = 0;
    for (const p of PILLARS) {
      const v = metricView(p.mtm, values[p.mtm.id], period, 10, 10, targets[p.mtm.id], nowFw);
      if (v.hasData) { total++; if (v.onTarget) good++; }
    }
    return { good, total };
  }, [values, targets, period, nowFw]);

  const per = PERIOD_LABELS[period];
  const scopeLabel = orgWide ? "company-wide" : storeCount != null ? `your ${storeCount} store${storeCount === 1 ? "" : "s"}` : "your stores";

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
                  period === pk ? "bg-accent text-white" : "bg-white text-ink-muted hover:bg-zinc-50 dark:bg-night-raised dark:text-night-muted dark:hover:bg-white/5",
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

      {scopedQ.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((p) => <div key={p.key} className={cn(PANEL, "h-[300px] animate-pulse")} />)}
        </div>
      ) : scopedQ.isError ? (
        <div className={cn(PANEL, "p-5 text-sm text-cherry")}>Couldn't load the metrics board.</div>
      ) : !data?.anchor ? (
        <div className={cn(PANEL, "p-5 text-sm text-ink-muted dark:text-night-muted")}>No metrics captured yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((p) => (
            <MtmTile key={p.key} pillar={p} scoped={values} company={companyValues} targets={targets} period={period} nowFw={nowFw} orgWide={orgWide} />
          ))}
        </div>
      )}

      {data?.anchor && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted dark:text-night-muted">
          {([["bg-emerald-500", "On / above target"], ["bg-amber-500", "Within 5%"], ["bg-red-500", "Off target"]] as const).map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-sm", c)} />{l}</span>
          ))}
          <span className="text-ink-subtle dark:text-night-muted/70">Scoped to {scopeLabel} · tap a card to see it vs. Company · Δ vs {per.compare.toLowerCase()}</span>
        </div>
      )}

      {infoOpen && (
        <Modal open onClose={() => setInfoOpen(false)} title="Where these numbers come from">
          <p className="mb-3 text-xs text-ink-muted dark:text-night-muted">
            These five headline metrics are scoped to {scopeLabel} and refresh every few minutes. Tap any card to flip it and
            see how you're doing vs. Company, plus that pillar's execution metrics. The full board has targets and per-store drill-downs.
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
