// Execution Metrics Board — the site-themed board (light cards, PageHeader,
// accent controls). Sections stack vertically (Sales / Customer L2R /
// Controllable Contribution …), each a Metric-That-Matters hero plus its
// execution metrics, with a Daily/WTD/MTD toggle, a previous-weeks picker,
// sparklines, and a trailing 5-week strip. Scope-selectable (company / region /
// store). Values + targets come from kpi-board; catalog holds defaults. Admins
// can edit targets; the labor target is data-driven (from the feed).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fiscalInfo, fiscalWeekRange } from "@/lib/fiscal";
import { PILLARS, type MetricDef, type Pillar } from "./catalog";
import { fetchKpiBoard, fetchStoreBreakdown, setBoardTarget, type MetricValues } from "./api";

// Metrics whose value rolls up from per-store $ — clickable to see each store.
const DRILLABLE = new Set(["cash_over_short", "paid_outs"]);
import { fmt, metricView, PERIOD_LABELS, type DeltaTone, type MetricView, type Period, type StatusTone } from "./logic";

const STATUS_BORDER: Record<StatusTone, string> = {
  good: "border-l-emerald-500", warn: "border-l-amber-500", bad: "border-l-red-500", none: "border-l-zinc-200",
};
const STATUS_STROKE: Record<StatusTone, string> = {
  good: "#059669", warn: "#d97706", bad: "#dc2626", none: "#a1a1aa",
};
const DELTA_TEXT: Record<DeltaTone, string> = { good: "text-emerald-600", bad: "text-red-600", flat: "text-zinc-400" };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const money0 = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);

// This week (latest) + the prior ~10 fiscal weeks, keyed by week-ending date.
function recentWeekOptions(): { value: string; label: string }[] {
  const cur = fiscalInfo(new Date())?.fiscalWeek ?? null;
  const opts = [{ value: "", label: "This week (latest)" }];
  if (!cur) return opts;
  for (let w = cur - 1; w >= Math.max(1, cur - 10); w--) {
    const r = fiscalWeekRange(w);
    if (!r) continue;
    const info = fiscalInfo(r.end);
    opts.push({
      value: ymd(r.end),
      label: `P${info?.period ?? "?"} W${info?.weekInPeriod ?? "?"} · ending ${r.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    });
  }
  return opts;
}

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

// The Metric That Matters hero card. `sub` is an optional extra line (e.g. the
// Sales-vs-LY dollar figure under the % headline).
function MtmHero({ v, sub }: { v: MetricView; sub?: string | null }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-accent/[0.06] to-transparent p-5 ring-1 ring-zinc-200">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-accent">Metric That Matters</div>
      <div className="mt-1 text-sm text-zinc-500">{v.name}</div>
      <div className="mt-2 flex items-end gap-2.5">
        <span className={cn("text-5xl font-bold leading-none tracking-tight tabular-nums", v.hasData ? "text-midnight" : "text-zinc-300")}>{v.value}</span>
        {v.delta && <span className={cn("pb-1 text-sm font-semibold tabular-nums", DELTA_TEXT[v.deltaTone])}>{v.delta}</span>}
        {!v.hasData && v.soon && (
          <span className="mb-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Coming soon</span>
        )}
      </div>
      {sub && <div className="mt-1 text-sm font-semibold tabular-nums text-midnight">{sub}</div>}
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

function ExecCard({ def, v, onDrill }: { def: MetricDef; v: MetricView; onDrill?: () => void }) {
  if (def.soon) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-l-2 border-zinc-200 border-l-zinc-200 bg-white px-3.5 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-midnight">{def.name}</div>
          <div className="text-[11px] text-zinc-400">{v.targetLabel}</div>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Coming soon</span>
      </div>
    );
  }
  const drillable = !!onDrill && v.hasData;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-l-2 border-zinc-200 bg-white px-3.5 py-3",
        STATUS_BORDER[v.statusTone],
        drillable && "cursor-pointer transition hover:ring-1 hover:ring-accent",
      )}
      onClick={drillable ? onDrill : undefined}
      role={drillable ? "button" : undefined}
      tabIndex={drillable ? 0 : undefined}
      onKeyDown={drillable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill?.(); } } : undefined}
      title={drillable ? "See per-store breakdown" : undefined}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1 truncate text-sm font-medium text-midnight">
          {def.name}
          {drillable && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" strokeWidth={2.5} />}
        </div>
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

function PillarCard({ p, values, targets, period, nowFw, onDrill }: { p: Pillar; values: Record<string, MetricValues>; targets: Record<string, number>; period: Period; nowFw: number | null; onDrill: (metricId: string, name: string) => void }) {
  const mtmV = metricView(p.mtm, values[p.mtm.id], period, 280, 48, targets[p.mtm.id], nowFw);
  const rowViews = p.rows.map((r) => ({ def: r, v: metricView(r, values[r.id], period, 92, 26, targets[r.id]) }));

  // Sales pillar: show the actual sales $ (and $ vs LY) under the % headline.
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
    <section className="overflow-hidden rounded-xl bg-white p-5 ring-1 ring-zinc-200 sm:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-sm font-semibold text-accent">{p.index}</span>
          <h2 className="text-lg font-bold tracking-tight text-midnight">{p.title}</h2>
        </div>
        {p.countLabel && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">{p.countLabel}</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <MtmHero v={mtmV} sub={sub} />
        <div className="grid content-start gap-2.5 sm:grid-cols-2">
          {rowViews.map(({ def, v }) => (
            <ExecCard key={def.id} def={def} v={v}
              onDrill={DRILLABLE.has(def.id) ? () => onDrill(def.id, def.name) : undefined} />
          ))}
        </div>
      </div>
    </section>
  );
}

// Admin: edit metric targets. Labor's target is data-driven (from the feed) and
// therefore not listed here.
function TargetsModal({ targets, onClose }: { targets: Record<string, number>; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const metrics = useMemo(
    () => PILLARS.flatMap((p) => [p.mtm, ...p.rows]).filter((m) => !m.soon && m.id !== "labor_pct"),
    [],
  );
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(metrics.map((m) => {
      const t = targets[m.id] ?? m.target;
      return [m.id, t == null ? "" : String(t)];
    })),
  );
  const save = useMutation({
    mutationFn: (m: MetricDef) => {
      const raw = draft[m.id]?.trim() ?? "";
      return setBoardTarget(m.id, raw === "" ? null : Number(raw));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kpi-board"] }); toast.push("Target saved.", "success"); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save the target.", "error"),
  });
  return (
    <Modal open onClose={onClose} title="Metric targets">
      <p className="mb-3 text-xs text-zinc-500">
        Set the target for each metric. Blank clears it back to the default. Labor % vs. Target is data-driven from the feed and isn't listed.
      </p>
      <div className="space-y-2">
        {metrics.map((m) => (
          <div key={m.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-midnight">{m.name}</div>
              <div className="text-[11px] text-zinc-400">default {m.target == null ? "—" : fmt(m.target, { ...m, signed: false })}</div>
            </div>
            <input
              type="number"
              step="any"
              value={draft[m.id] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [m.id]: e.target.value }))}
              className="w-24 rounded-md border border-zinc-200 px-2 py-1 text-right text-sm focus:border-accent focus:outline-none"
            />
            <span className="w-6 text-xs text-zinc-400">{m.unit}</span>
            <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate(m)}>Save</Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// Per-store breakdown for a $ metric (Cash Over/Short, Paid Outs).
function BreakdownModal({ metricId, name, level, id, date, period, periodLabel, onClose }: {
  metricId: string; name: string; level: string; id: string | null; date: string | null; period: Period; periodLabel: string; onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["kpi-breakdown", metricId, level, id, date, period],
    queryFn: () => fetchStoreBreakdown(metricId, level, id, date, period),
    staleTime: 60_000,
  });
  const d = q.data;
  const usd = (v: number) => {
    const dp = metricId === "cash_over_short" ? 2 : 2;
    const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return `${v < 0 ? "−" : ""}$${s}`;
  };
  // Cash over/short: red when short (negative). Paid outs: neutral.
  const tone = (v: number) => (metricId === "cash_over_short" ? (v < 0 ? "text-red-600" : "text-emerald-700") : "text-midnight");
  return (
    <Modal open onClose={onClose} title={`${name} — by store`}>
      <div className="mb-2 flex items-baseline justify-between text-xs text-zinc-500">
        <span>{periodLabel}{d?.anchor ? ` · through ${new Date(`${d.anchor}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span>
        {d?.total != null && <span>Total <b className="tabular-nums text-midnight">{usd(d.total)}</b> · {d.count} stores</span>}
      </div>
      {q.isLoading ? (
        <div className="py-6 text-center text-sm text-zinc-500">Loading…</div>
      ) : q.isError ? (
        <div className="py-6 text-center text-sm text-red-600">{(q.error as Error)?.message ?? "Couldn't load."}</div>
      ) : !d || d.stores.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-400">No store values for this period.</div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-[10px] uppercase tracking-wide text-zinc-400">
              <tr><th className="py-1.5">Store</th><th className="py-1.5 text-right">{name}</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {d.stores.map((s) => (
                <tr key={s.store_number}>
                  <td className="py-1.5">
                    <span className="font-semibold text-midnight">#{s.store_number}</span>
                    <span className="ml-1.5 text-zinc-500">{s.store_name}</span>
                    {s.region && <span className="ml-1.5 text-[11px] text-zinc-400">· {s.region}</span>}
                  </td>
                  <td className={cn("py-1.5 text-right font-semibold tabular-nums", tone(s.value))}>{usd(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

const selCls = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none";

export function MetricsBoard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [period, setPeriod] = useState<Period>("wtd");
  const [level, setLevel] = useState<"company" | "region" | "store">("company");
  const [id, setId] = useState<string | null>(null);
  const [weekEnd, setWeekEnd] = useState<string>(""); // "" = this week (latest)
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [drill, setDrill] = useState<{ metricId: string; name: string } | null>(null);
  const weekOptions = useMemo(() => recentWeekOptions(), []);

  const q = useQuery({
    queryKey: ["kpi-board", level, id, weekEnd],
    queryFn: () => fetchKpiBoard(level, id, weekEnd || null),
    refetchInterval: weekEnd ? false : 5 * 60_000,
  });
  const data = q.data;
  const values = data?.values ?? {};
  const targets = data?.targets ?? {};

  // On-target counter across every metric (MTMs included).
  let total = 0, good = 0;
  for (const p of PILLARS) for (const m of [p.mtm, ...p.rows]) {
    if (m.soon) continue;
    const v = metricView(m, values[m.id], period, 10, 10, targets[m.id]);
    if (v.hasData) { total++; if (v.onTarget) good++; }
  }

  const per = PERIOD_LABELS[period];
  const dateLabel = data?.anchor ? new Date(`${data.anchor}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "—";
  const fiscalLabel = data?.fiscal ? `Period ${data.fiscal.period}, Week ${data.fiscal.weekInPeriod}` : "";
  // Fiscal week number of the anchor (NOW), to label the trend FW28…FW32.
  const nowFw = data?.anchor ? (fiscalInfo(new Date(`${data.anchor}T12:00:00`))?.fiscalWeek ?? null) : null;

  return (
    <>
      <PageHeader
        title="Execution Metrics Board"
        description={data?.anchor ? `${dateLabel}${fiscalLabel ? ` · ${fiscalLabel}` : ""} · comparison: ${per.compare}` : "Metrics That Matter — sales, service, and speed."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} className={selCls} title="Week">
              {weekOptions.map((o) => <option key={o.value || "latest"} value={o.value}>{o.label}</option>)}
            </select>
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
            {isAdmin && (
              <Button size="sm" variant="secondary" onClick={() => setTargetsOpen(true)}>
                <SlidersHorizontal className="mr-1 h-3.5 w-3.5" /> Targets
              </Button>
            )}
          </div>
        }
      />

      {targetsOpen && <TargetsModal targets={targets} onClose={() => setTargetsOpen(false)} />}

      {drill && (
        <BreakdownModal
          metricId={drill.metricId}
          name={drill.name}
          level={level}
          id={id}
          date={weekEnd || null}
          period={period}
          periodLabel={per.label}
          onClose={() => setDrill(null)}
        />
      )}

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

          {PILLARS.map((p) => <PillarCard key={p.key} p={p} values={values} targets={targets} period={period} nowFw={nowFw} onDrill={(mid, name) => setDrill({ metricId: mid, name })} />)}
        </div>
      )}
    </>
  );
}
