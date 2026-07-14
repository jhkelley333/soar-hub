// Single-store dashboard for the NEW ranker — the legacy Ranker's Store View
// look (hero, narrative, momentum, execution-score ring, guest signals, and a
// KPI scorecard with sparklines + vs-LW deltas) rendered from the CURRENT
// run's new-engine data. No week/peer selectors: it always shows the run the
// board is on. Historical week navigation lives on the board's week picker.

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { ScoreRing } from "@/modules/ranker/components/ScoreRing";
import {
  fetchRankingLatest, fetchRankingTrends,
  type RankScope, type RankingResultRow, type RankingRun, type TrendStore,
} from "./api";

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const fmtMoney = (v: unknown) => (isNum(v) ? `$${Math.round(v).toLocaleString("en-US")}` : "—");
const fmtPct1 = (v: unknown) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—");
const fmtSignedPts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)} pts vs LW`;
const fmtSignedPct = (v: unknown) => (isNum(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—");
const fmtNum1 = (v: unknown) => (isNum(v) ? v.toFixed(1) : typeof v === "string" ? v : "—");
const last = (a: number[]) => (a.length ? a[a.length - 1] : null);
const prev = (a: number[]) => (a.length >= 2 ? a[a.length - 2] : null);
// Slope over the last few points: sign of last - mean(earlier).
function trend(series: (number | null)[] | undefined): 1 | 0 | -1 {
  const s = (series ?? []).filter(isNum);
  if (s.length < 2) return 0;
  const l = s[s.length - 1], base = s.slice(0, -1).reduce((a, b) => a + b, 0) / (s.length - 1);
  const d = l - base;
  const eps = Math.abs(base) * 0.005 + 1e-9;
  return d > eps ? 1 : d < -eps ? -1 : 0;
}

function Sparkline({ data, lowerIsBetter }: { data: (number | null)[]; lowerIsBetter?: boolean }) {
  const pts = data.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => isNum(p.v));
  if (pts.length < 2) return <div className="h-8 text-[10px] text-zinc-300">—</div>;
  const xs = pts.map((p) => p.i), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 140, H = 34, pad = 3;
  const sx = (x: number) => (maxX === minX ? W / 2 : pad + ((x - minX) / (maxX - minX)) * (W - 2 * pad));
  const sy = (y: number) => pad + (1 - (maxY === minY ? 0.5 : (y - minY) / (maxY - minY))) * (H - 2 * pad);
  const d = pts.map((p, idx) => `${idx ? "L" : "M"}${sx(p.i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const first = pts[0].v, lv = pts[pts.length - 1].v;
  const better = lowerIsBetter ? lv < first : lv > first;
  const stroke = lv === first ? "#a1a1aa" : better ? "#059669" : "#dc2626";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(pts[pts.length - 1].i)} cy={sy(lv)} r={2} fill={stroke} />
    </svg>
  );
}

function toneText(t: "good" | "bad" | "warn") {
  return t === "good" ? "text-emerald-600" : t === "bad" ? "text-red-600" : "text-amber-600";
}

function HeroStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-1 font-mono text-3xl font-black text-midnight">{value}</div>
      {sub && <div className={cn("mt-2 text-xs font-semibold", tone ? toneText(tone) : "text-zinc-400")}>{sub}</div>}
    </div>
  );
}

function MomBox({ label, word, tone }: { label: string; word: string; tone: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-white p-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-sm font-bold", toneText(tone))}>{word}</div>
    </div>
  );
}

function KpiCard({ label, value, delta, deltaTone, series, lowerIsBetter }: {
  label: string; value: string; delta?: string; deltaTone?: "good" | "bad" | "warn"; series?: (number | null)[]; lowerIsBetter?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-200">
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-bold text-midnight">{value}</div>
      <div className={cn("text-[11px] font-semibold", delta ? (deltaTone ? toneText(deltaTone) : "text-zinc-400") : "text-amber-600")}>
        {delta ?? "No prior data"}
      </div>
      {series && <div className="mt-1"><Sparkline data={series} lowerIsBetter={lowerIsBetter} /></div>}
    </div>
  );
}

export function RankingStoreView({ row, run }: { row: RankingResultRow; run?: RankingRun | null }) {
  const m = row.metrics;
  const num = String(row.entity_key);

  const trendsQ = useQuery({ queryKey: ["ranking-trends", 12], queryFn: () => fetchRankingTrends(12), staleTime: 5 * 60_000 });
  const t: TrendStore | undefined = trendsQ.data?.stores?.[num];

  // Week-over-week (from the stitched trend tail).
  const rankS = (t?.rank ?? []).filter(isNum);
  const rankMove = isNum(last(rankS)) && isNum(prev(rankS)) ? (last(rankS) as number) - (prev(rankS) as number) : null;
  const salesS = (t?.sales ?? []).filter(isNum);
  const salesDelta = isNum(last(salesS)) && isNum(prev(salesS)) ? (last(salesS) as number) - (prev(salesS) as number) : null;
  const ptsDelta = (series: (number | null)[] | undefined) => {
    const s = (series ?? []).filter(isNum);
    return isNum(last(s)) && isNum(prev(s)) ? (last(s) as number) - (prev(s) as number) : null;
  };

  // Momentum (sales & guest: up = good; labor: up = bad).
  const salesMom = trend(t?.sales);
  const laborMom = trend(t?.labor);
  const guestMom = trend(t?.ontime);
  const vogCount = isNum(m.vogResponses) ? (m.vogResponses as number) : null;

  // Execution score 0-100: labor / VOG count adequacy / complaints / BSC.
  const execParts: number[] = [];
  if (isNum(m.laborScore)) execParts.push((m.laborScore as number) / 5);
  if (isNum(m.bscScore)) execParts.push((m.bscScore as number) / 5);
  if (isNum(m.complaintsScore)) execParts.push((m.complaintsScore as number) / 5);
  if (vogCount != null) execParts.push(Math.min(1, vogCount / 21));
  const exec = execParts.length ? Math.round((execParts.reduce((a, b) => a + b, 0) / execParts.length) * 100) : null;

  // Narrative.
  const bits: string[] = [];
  if (rankMove != null && rankMove !== 0) bits.push(`Rank ${rankMove > 0 ? "slipped" : "improved"} ${Math.abs(rankMove)} spot${Math.abs(rankMove) === 1 ? "" : "s"}`);
  else if (rankMove === 0) bits.push("Rank held");
  if (salesMom > 0) bits.push("sales momentum is building");
  else if (salesMom < 0) bits.push("sales are softening");
  if (isNum(m.laborScore)) bits.push((m.laborScore as number) >= 4 ? "labor is well-controlled" : (m.laborScore as number) <= 2 ? "labor is running over chart" : "labor is on the line");
  if (vogCount != null) bits.push(vogCount >= 21 ? "VOG count is on target" : "VOG count is below the 21-mark");
  const narrative = bits.length ? bits.join(" · ") + "." : "";

  const KPIS: { label: string; value: string; series?: (number | null)[]; lowerIsBetter?: boolean; deltaPts?: number | null; deltaTone?: "good" | "bad" | "warn" }[] = [
    { label: "Weekly Sales", value: fmtMoney(m.sales), series: t?.sales, deltaPts: null, deltaTone: salesDelta != null && salesDelta >= 0 ? "good" : "bad" },
    { label: "% vs LY", value: fmtPct1(m.pctVsLy), series: t?.vsly, deltaPts: ptsDelta(t?.vsly) },
    { label: "COGS eff %", value: fmtPct1(m.cogsEff), series: t?.cogs, deltaPts: ptsDelta(t?.cogs) },
    { label: "Labor %", value: fmtPct1(m.laborPct), series: t?.labor, lowerIsBetter: true, deltaPts: ptsDelta(t?.labor), deltaTone: (ptsDelta(t?.labor) ?? 0) <= 0 ? "good" : "bad" },
    { label: "On Time %", value: fmtPct1(m.onTimePct), series: t?.ontime, deltaPts: ptsDelta(t?.ontime) },
    { label: "Rank", value: isNum(row.rank) ? `#${row.rank}` : "—", series: t?.rank, lowerIsBetter: true },
    { label: "Annualized FC Miss", value: fmtMoney(m.fcAnnualized) },
    { label: "Var to Chart", value: fmtSignedPct(m.varianceToChart) },
    { label: "BSC Training %", value: fmtPct1(m.bscTrainingPct) },
    { label: "VOG Week", value: fmtPct1(m.vog) },
    { label: "Complaints", value: fmtNum1(m.complaints) },
    { label: "Calls /10k", value: fmtNum1(m.callsPer10k) },
  ];

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Store View</div>
          <div className="mt-1 text-lg font-black text-midnight">{String(m.location ?? `Store ${num}`)}</div>
          <div className="text-xs text-zinc-500">GM: <span className="font-semibold text-zinc-700">{String(m.gm ?? "—")}</span></div>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">STORE {num}</span>
            {run && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">P{run.period}W{run.week}</span>}
          </div>
          {narrative && <p className="mt-2 text-xs leading-relaxed text-zinc-600">{narrative}</p>}
        </div>
        <HeroStat label="Rank" value={isNum(row.rank) ? `#${row.rank}` : "—"}
          sub={rankMove == null ? undefined : rankMove === 0 ? "no change" : `${rankMove > 0 ? "▲" : "▼"} ${Math.abs(rankMove)} vs LW`}
          tone={rankMove == null ? undefined : rankMove > 0 ? "bad" : rankMove < 0 ? "good" : "warn"} />
        <HeroStat label="Weekly Sales" value={fmtMoney(m.sales)}
          sub={salesDelta == null ? undefined : `${salesDelta >= 0 ? "+" : "−"}${fmtMoney(Math.abs(salesDelta))} vs LW`}
          tone={salesDelta == null ? undefined : salesDelta >= 0 ? "good" : "bad"} />
        <HeroStat label="VOG Count" value={`${vogCount ?? "—"} / 21`}
          sub={vogCount == null ? undefined : vogCount >= 21 ? "On Target" : "Below Target"}
          tone={vogCount == null ? undefined : vogCount >= 21 ? "good" : vogCount >= 15 ? "warn" : "bad"} />
      </div>

      {/* Momentum / Execution / Guest signals */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Momentum</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MomBox label="Sales" word={salesMom > 0 ? "Improving" : salesMom < 0 ? "Softening" : "Stable"} tone={salesMom > 0 ? "good" : salesMom < 0 ? "bad" : "warn"} />
            <MomBox label="Labor" word={laborMom > 0 ? "Rising" : laborMom < 0 ? "Improving" : "Stable"} tone={laborMom > 0 ? "bad" : laborMom < 0 ? "good" : "warn"} />
            <MomBox label="Guest" word={guestMom > 0 ? "Improving" : guestMom < 0 ? "Softening" : "Stable"} tone={guestMom > 0 ? "good" : guestMom < 0 ? "bad" : "warn"} />
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-zinc-200">
          <ScoreRing score={exec} size={90} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Execution Score</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">Composite of labor, VOG count, complaints, and BSC training.</p>
            <div className={cn("mt-2 text-xs font-semibold", exec == null ? "text-zinc-400" : exec >= 75 ? "text-emerald-600" : exec >= 50 ? "text-amber-600" : "text-red-600")}>
              {exec == null ? "Not enough data" : exec >= 75 ? "Strong execution" : exec >= 50 ? "Room to improve" : "Needs attention"}
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Guest Signals</div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">VOG Week</div>
              <div className="mt-1 font-semibold text-midnight">{fmtPct1(m.vog)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">VOG Count</div>
              <div className="mt-1 font-semibold text-midnight">{vogCount ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Complaints</div>
              <div className="mt-1 font-semibold text-midnight">{fmtNum1(m.complaints)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI scorecard */}
      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Full Scorecard{run ? ` — P${run.period}W${run.week}` : ""}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {KPIS.map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value} series={k.series} lowerIsBetter={k.lowerIsBetter}
              delta={k.deltaPts != null ? fmtSignedPts(k.deltaPts) : k.label === "Weekly Sales" && salesDelta != null ? `${salesDelta >= 0 ? "+" : "−"}${fmtMoney(Math.abs(salesDelta))} vs LW` : undefined}
              deltaTone={k.deltaTone ?? (k.deltaPts != null ? (k.deltaPts >= 0 ? "good" : "bad") : undefined)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// The GM's landing — their own store's dashboard for the current run.
export function MyStoreView() {
  const q = useQuery({ queryKey: ["ranking-mystore", "ptd"], queryFn: () => fetchRankingLatest("ptd" as RankScope, "store"), staleTime: 60_000 });
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;
  const run = q.data?.run ?? null;
  const rows = q.data?.rows ?? [];
  if (!run || !rows.length) return <EmptyState title="No ranking yet" description="Your store hasn't been ranked in the latest run." />;
  return <RankingStoreView row={rows[0]} run={run} />;
}
