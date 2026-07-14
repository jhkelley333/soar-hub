// A single store's ranking in the legacy Ranker's store-dashboard style:
// a hero (rank / points / sales / fin miss / VOG), the category score chips,
// and a KPI scorecard with sparklines. Sourced entirely from the new ranking
// data — the run's store row plus the trends series — so a GM sees their store
// the way the sheet used to show it. Rendered when a store row is opened, and
// the default view for GMs (who own a single store).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Segmented } from "@/shared/ui/Segmented";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchRankingLatest, fetchRankingTrends, type RankScope, type RankingResultRow, type TrendStore } from "./api";

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const fmtMoney = (v: unknown) => (isNum(v) ? `$${Math.round(v).toLocaleString("en-US")}` : "—");
const fmtPct1 = (v: unknown) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—");
const fmtSignedPct = (v: unknown) => (isNum(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—");
const fmtNum1 = (v: unknown) => (isNum(v) ? v.toFixed(1) : typeof v === "string" ? v : "—");

const SCORE_BG: Record<number, string> = {
  1: "bg-red-600", 2: "bg-amber-500", 3: "bg-zinc-400", 4: "bg-emerald-500", 5: "bg-emerald-700",
};
function ScoreChip({ label, v }: { label: string; v: unknown }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-md font-mono text-sm font-bold text-white",
        isNum(v) ? SCORE_BG[v] ?? "bg-zinc-300" : "bg-zinc-200 !text-zinc-400")}>
        {isNum(v) ? v : "–"}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
    </div>
  );
}

// Tiny inline sparkline. The line always follows the RAW value (higher value =
// higher on the chart), so it moves the same way the hero delta arrow does.
// `lowerIsBetter` only flips the good/bad color (rank, labor): a rising line is
// red for those, green for everything else.
function Sparkline({ data, lowerIsBetter }: { data: (number | null)[]; lowerIsBetter?: boolean }) {
  const pts = data.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => isNum(p.v));
  if (pts.length < 2) return <div className="h-7 text-[10px] text-zinc-300">—</div>;
  const xs = pts.map((p) => p.i), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 120, H = 28, pad = 2;
  const sx = (x: number) => (maxX === minX ? W / 2 : pad + ((x - minX) / (maxX - minX)) * (W - 2 * pad));
  const sy = (y: number) => {
    const t = maxY === minY ? 0.5 : (y - minY) / (maxY - minY);
    return pad + (1 - t) * (H - 2 * pad); // higher value always plots higher
  };
  const d = pts.map((p, idx) => `${idx ? "L" : "M"}${sx(p.i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const first = pts[0].v, last = pts[pts.length - 1].v;
  const better = lowerIsBetter ? last < first : last > first;
  const stroke = last === first ? "#a1a1aa" : better ? "#059669" : "#dc2626";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(pts[pts.length - 1].i)} cy={sy(last)} r={1.8} fill={stroke} />
    </svg>
  );
}

function HeroStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-1 font-mono text-2xl font-black text-midnight">{value}</div>
      {sub && <div className={cn("mt-0.5 text-xs font-semibold",
        tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-zinc-400")}>{sub}</div>}
    </div>
  );
}

function KpiCard({ label, value, series, lowerIsBetter }: { label: string; value: string; series?: (number | null)[]; lowerIsBetter?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-200">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-lg font-bold text-midnight">{value}</div>
      {series && <div className="mt-1"><Sparkline data={series} lowerIsBetter={lowerIsBetter} /></div>}
    </div>
  );
}

export function RankingStoreView({ row, showLaborLink = true }: { row: RankingResultRow; showLaborLink?: boolean }) {
  const m = row.metrics;
  const num = String(row.entity_key);

  // Trends supply the sparklines (rank / sales / vs LY / labor / COGS / on-time).
  const trendsQ = useQuery({
    queryKey: ["ranking-trends", 12],
    queryFn: () => fetchRankingTrends(12),
    staleTime: 5 * 60_000,
  });
  const t: TrendStore | undefined = trendsQ.data?.stores?.[num];

  // Rank movement, week over week (current run vs the immediately prior ranked
  // week). rankMove follows the rank NUMBER: positive = the number rose (e.g.
  // 8 -> 9), which is WORSE. The arrow points the way the number moved; the
  // color says whether that was good or bad (lower rank number = better).
  const rankSeries = (t?.rank ?? []).filter(isNum);
  const rankCur = rankSeries.length >= 1 ? rankSeries[rankSeries.length - 1] : null;
  const rankPrev = rankSeries.length >= 2 ? rankSeries[rankSeries.length - 2] : null;
  const rankMove = isNum(rankCur) && isNum(rankPrev) ? rankCur - rankPrev : null;
  const salesSeries = (t?.sales ?? []).filter(isNum);
  const salesDelta = salesSeries.length >= 2 ? salesSeries[salesSeries.length - 1] - salesSeries[salesSeries.length - 2] : null;

  const CHIPS: [string, string][] = [
    ["Sales", "salesScore"], ["Food", "fcScore"], ["Labor", "laborScore"],
    ["BSC", "bscScore"], ["On time", "onTimeScore"], ["EcoSure", "ecosureScore"],
    ["VOG", "vogScore"], ["Complaints", "complaintsScore"],
  ];

  const KPIS: { label: string; value: string; series?: (number | null)[]; lowerIsBetter?: boolean }[] = [
    { label: "Weekly Sales", value: fmtMoney(m.sales), series: t?.sales },
    { label: "% vs LY", value: fmtSignedPct(m.pctVsLy), series: t?.vsly },
    { label: "COGS eff", value: fmtPct1(m.cogsEff), series: t?.cogs },
    { label: "Labor %", value: fmtPct1(m.laborPct), series: t?.labor, lowerIsBetter: true },
    { label: "On time", value: fmtPct1(m.onTimePct), series: t?.ontime },
    { label: "Rank", value: isNum(row.rank) ? `#${row.rank}` : "—", series: t?.rank, lowerIsBetter: true },
    { label: "FC $ miss", value: fmtMoney(m.fcMiss) },
    { label: "FC annualized", value: fmtMoney(m.fcAnnualized) },
    { label: "Var to chart", value: fmtSignedPct(m.varianceToChart) },
    { label: "Labor $ miss", value: fmtMoney(m.laborMiss) },
    { label: "BSC training", value: fmtPct1(m.bscTrainingPct) },
    { label: "Calls /10k", value: fmtNum1(m.callsPer10k) },
  ];

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 rounded-xl bg-midnight p-4 text-white lg:col-span-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">Store</div>
          <div className="mt-1 font-mono text-lg font-black">#{num}</div>
          <div className="text-xs text-white/70">{String(m.location ?? "")}</div>
          <div className="mt-1 text-xs text-white/60">GM: <span className="font-semibold text-white/90">{String(m.gm ?? "—")}</span></div>
        </div>
        <HeroStat label="Rank" value={isNum(row.rank) ? `#${row.rank}` : "—"}
          sub={rankMove == null ? undefined : rankMove === 0 ? "no change"
            : `${rankMove > 0 ? "▲" : "▼"} ${Math.abs(rankMove)} place${Math.abs(rankMove) === 1 ? "" : "s"}`}
          tone={rankMove == null ? undefined : rankMove > 0 ? "bad" : rankMove < 0 ? "good" : "warn"} />
        <HeroStat label="Total points" value={isNum(row.total_points) ? String(row.total_points) : "—"} />
        <HeroStat label="Weekly sales" value={fmtMoney(m.sales)}
          sub={salesDelta == null ? undefined : `${salesDelta >= 0 ? "▲" : "▼"} ${fmtMoney(Math.abs(salesDelta))} vs prior`}
          tone={salesDelta == null ? undefined : salesDelta >= 0 ? "good" : "bad"} />
        <HeroStat label="Fin $ miss" value={fmtMoney(m.finMiss)}
          sub={isNum(m.finAnnualized) ? `${fmtMoney(m.finAnnualized)} annualized` : undefined}
          tone={isNum(m.finMiss) && (m.finMiss as number) > 0 ? "bad" : "good"} />
      </div>

      {/* Category scores */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Category scores</span>
          <span className="flex items-baseline gap-3 text-xs text-zinc-500">
            <span>Fin <b className="font-mono text-sm text-midnight">{isNum(m.finScore) ? m.finScore : "–"}</b></span>
            <span>Ops <b className="font-mono text-sm text-midnight">{isNum(m.opsScore) ? m.opsScore : "–"}</b></span>
          </span>
        </div>
        <div className="flex flex-wrap gap-4">
          {CHIPS.map(([label, key]) => <ScoreChip key={key} label={label} v={m[key]} />)}
        </div>
      </div>

      {/* KPI scorecard */}
      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Scorecard{trendsQ.isLoading ? " · loading trends…" : t ? " · 12-week trend" : ""}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {KPIS.map((k) => <KpiCard key={k.label} {...k} />)}
        </div>
      </div>

      {showLaborLink && (
        <Link to="/labor-v2" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
          Open Labor v2 <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—";

// The GM's landing: fetch the caller's (scope-filtered) store rows and show the
// dashboard. A store switcher appears only when the caller owns more than one.
export function MyStoreView() {
  const [scope, setScope] = useState<RankScope>("ptd");
  const [sel, setSel] = useState(0);
  const q = useQuery({
    queryKey: ["ranking-mystore", scope],
    queryFn: () => fetchRankingLatest(scope, "store"),
    staleTime: 60_000,
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;
  const run = q.data?.run ?? null;
  const rows = q.data?.rows ?? [];
  if (!run || !rows.length) {
    return <EmptyState title="No ranking yet" description="Your store hasn't been ranked in the latest run, or no run has completed." />;
  }
  const idx = Math.min(sel, rows.length - 1);
  const row = rows[idx];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          Period <b className="text-midnight">{run.period}</b> · Week <b className="text-midnight">{run.week}</b> ·
          Week ending <b className="text-midnight">{fmtDate(run.week_ending)}</b>
        </p>
        <Segmented<RankScope> dense value={scope} onChange={setScope}
          options={[{ value: "ptd", label: "Period to date" }, { value: "wtd", label: "Week to date" }]} />
      </div>
      {rows.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r, i) => (
            <button key={r.entity_key} onClick={() => setSel(i)}
              className={cn("rounded-full border px-2.5 py-1 text-xs font-bold transition",
                i === idx ? "border-midnight bg-midnight text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300")}>
              #{r.entity_key}
            </button>
          ))}
        </div>
      )}
      <RankingStoreView row={row} />
    </div>
  );
}
