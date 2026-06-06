// Ranker — Head-to-Head tab. Two stores side by side for the selected
// week. Each metric row shows both values plus a margin-of-victory bar
// that respects "lower is better" for rank/labor/complaints/calls — so
// the winning side is always the visually-favored half.

import { useQueries } from "@tanstack/react-query";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchStoreDashboard } from "./api";
import { fmtMetric, num, rankDelta, toneTextClass } from "./format";
import type { MetricKey, StoreDashboardResponse } from "./types";

interface Props {
  week: string;
  storeA: string;
  storeB: string;
}

const METRICS: { key: MetricKey; label: string; lowerBetter: boolean }[] = [
  { key: "storeRank", label: "Store Rank", lowerBetter: true },
  { key: "weeklySales", label: "Weekly Sales", lowerBetter: false },
  { key: "vsLastYear", label: "% vs Last Year", lowerBetter: false },
  { key: "cogsEff", label: "COGS Efficiency", lowerBetter: false },
  { key: "annualizedFcMiss", label: "Ann. FC Miss", lowerBetter: true },
  { key: "laborPct", label: "Labor %", lowerBetter: true },
  { key: "varToChart", label: "Var to Chart", lowerBetter: false },
  { key: "bscTraining", label: "BSC Training", lowerBetter: false },
  { key: "onTimeTickets", label: "On Time Tickets", lowerBetter: false },
  { key: "vogWeek", label: "VOG Week", lowerBetter: false },
  { key: "vogCount", label: "VOG Count", lowerBetter: false },
  { key: "complaints", label: "Complaints", lowerBetter: true },
  { key: "callsPer10k", label: "Calls /10k", lowerBetter: true },
];

// Returns winner side ("A" | "B" | "tie") and a 0..100 magnitude of the
// gap, expressed as a percent of the worse value. Capped at 100 so a
// 0-vs-positive case (e.g. 0 complaints vs 5) renders as full bar.
function marginOfVictory(
  a: number | null,
  b: number | null,
  lowerBetter: boolean,
): { winner: "A" | "B" | "tie"; pct: number } {
  if (a === null || b === null) return { winner: "tie", pct: 0 };
  if (a === b) return { winner: "tie", pct: 0 };
  const aWins = lowerBetter ? a < b : a > b;
  const denom = Math.abs(aWins ? b : a) || 1;
  const pct = Math.min(
    100,
    Math.round((Math.abs(a - b) / denom) * 100),
  );
  return { winner: aWins ? "A" : "B", pct };
}

export function H2HView({ week, storeA, storeB }: Props) {
  // Hook runs unconditionally (react-hooks/rules-of-hooks); it's just
  // disabled until two distinct stores are picked. The empty state returns
  // below, after the hook.
  const ready = !!storeA && !!storeB && storeA !== storeB;

  const results = useQueries({
    queries: [
      {
        queryKey: ["ranker", "h2h", week, storeA],
        queryFn: () =>
          fetchStoreDashboard({
            week,
            store: storeA!,
            trendWeeks: 8,
          }),
        enabled: ready,
        staleTime: 60_000,
      },
      {
        queryKey: ["ranker", "h2h", week, storeB],
        queryFn: () =>
          fetchStoreDashboard({
            week,
            store: storeB!,
            trendWeeks: 8,
          }),
        enabled: ready,
        staleTime: 60_000,
      },
    ],
  });
  const [qA, qB] = results;

  if (!ready) {
    return (
      <EmptyState
        title="Pick two different stores"
        description="Choose Store A and Store B from the toolbar above to compare."
      />
    );
  }

  if (qA.isLoading || qB.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (qA.isError || qB.isError) {
    return (
      <EmptyState
        title="Couldn't load comparison"
        description={
          ((qA.error || qB.error) as Error | undefined)?.message ?? "Try again."
        }
      />
    );
  }
  if (!qA.data || !qB.data) return null;
  const dA = qA.data;
  const dB = qB.data;

  if (!dA.found || !dB.found || !dA.metrics || !dB.metrics) {
    return (
      <EmptyState
        title="One of these stores has no data this week"
        description="Try a different week or pick another pair."
      />
    );
  }

  // Tally wins for the headline.
  let winsA = 0;
  let winsB = 0;
  for (const m of METRICS) {
    const a = num(dA.metrics![m.key]);
    const b = num(dB.metrics![m.key]);
    if (a === null || b === null || a === b) continue;
    const aWins = m.lowerBetter ? a < b : a > b;
    if (aWins) winsA++;
    else winsB++;
  }
  const winnerSide: "A" | "B" | "tie" =
    winsA > winsB ? "A" : winsB > winsA ? "B" : "tie";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SideCard data={dA} wins={winsA} highlight={winnerSide === "A"} />
        <SideCard data={dB} wins={winsB} highlight={winnerSide === "B"} />
      </div>

      <Card className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Head-to-Head — Week {dA.week}
        </div>
        <div className="mt-3 space-y-3">
          {METRICS.map((m) => {
            const a = num(dA.metrics![m.key]);
            const b = num(dB.metrics![m.key]);
            const mov = marginOfVictory(a, b, m.lowerBetter);
            return (
              <MetricRow
                key={m.key}
                label={m.label}
                a={fmtMetric(m.key, dA.metrics![m.key])}
                b={fmtMetric(m.key, dB.metrics![m.key])}
                winner={mov.winner}
                pct={mov.pct}
              />
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function SideCard({
  data,
  wins,
  highlight,
}: {
  data: StoreDashboardResponse;
  wins: number;
  highlight: boolean;
}) {
  const m = data.metrics!;
  const rd = rankDelta(data.rankMovement ?? null);
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Store {data.store}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-midnight">
        {m.storeName || `Store ${data.store}`}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">
        GM: <span className="font-medium text-zinc-700">{m.gmName || "—"}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">
          Rank: <span className="font-semibold">{fmtMetric("storeRank", m.storeRank)}</span>
        </span>
        <span className={`${toneTextClass(rd.tone)} font-medium`}>{rd.text}</span>
      </div>
      <div
        className={`mt-3 text-2xl font-semibold tracking-tight ${
          highlight ? "text-emerald-600" : "text-zinc-700"
        }`}
      >
        {wins} {wins === 1 ? "win" : "wins"}
      </div>
    </Card>
  );
}

function MetricRow({
  label,
  a,
  b,
  winner,
  pct,
}: {
  label: string;
  a: string;
  b: string;
  winner: "A" | "B" | "tie";
  pct: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div className="text-right">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </div>
        <div
          className={`text-sm font-semibold ${
            winner === "A" ? "text-emerald-600" : winner === "B" ? "text-zinc-500" : "text-zinc-700"
          }`}
        >
          {a}
        </div>
      </div>

      {/* Margin-of-victory bar */}
      <div className="flex items-center gap-1 text-[10px]">
        <div className="h-2 w-16 overflow-hidden rounded-full bg-zinc-100">
          {winner === "A" && (
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${pct}%`, marginLeft: `${100 - pct}%` }}
            />
          )}
        </div>
        <div className="w-8 text-center text-zinc-400">
          {winner === "tie" ? "tie" : `${pct}%`}
        </div>
        <div className="h-2 w-16 overflow-hidden rounded-full bg-zinc-100">
          {winner === "B" && (
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </div>
        <div
          className={`text-sm font-semibold ${
            winner === "B" ? "text-emerald-600" : winner === "A" ? "text-zinc-500" : "text-zinc-700"
          }`}
        >
          {b}
        </div>
      </div>
    </div>
  );
}
