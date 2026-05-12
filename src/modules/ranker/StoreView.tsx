// Ranker — Store View tab. Hero with rank/sales/VOG, momentum + execution
// score + guest signals row, and a 12-card KPI scorecard with sparklines
// driven by a 4W/8W/12W toggle.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchStoreDashboard } from "./api";
import {
  deltaClass,
  deltaText,
  fmtMetric,
  num,
  rankDelta,
  toneTextClass,
} from "./format";
import { buildNarrative } from "./narrative";
import { KpiCard } from "./components/KpiCard";
import { ScoreRing } from "./components/ScoreRing";
import { TrendPills } from "./components/TrendPills";
import type { MetricKey, Metrics, PeerCandidate } from "./types";
import { money } from "./format";

interface Props {
  week: string;
  store: string;
  peerStore: string;
  onPeerChange: (peer: string) => void;
  onPeerCandidatesLoaded: (peers: PeerCandidate[]) => void;
}

const KPI_LIST: { label: string; key: MetricKey }[] = [
  { label: "Weekly Sales", key: "weeklySales" },
  { label: "% vs LY", key: "vsLastYear" },
  { label: "COGS Eff %", key: "cogsEff" },
  { label: "Annualized FC Miss", key: "annualizedFcMiss" },
  { label: "Labor %", key: "laborPct" },
  { label: "Var to Chart", key: "varToChart" },
  { label: "BSC Training %", key: "bscTraining" },
  { label: "On Time Tickets %", key: "onTimeTickets" },
  { label: "VOG Week", key: "vogWeek" },
  { label: "VOG Count", key: "vogCount" },
  { label: "Complaints", key: "complaints" },
  { label: "Calls /10k", key: "callsPer10k" },
];

export function StoreView({
  week,
  store,
  peerStore,
  onPeerChange,
  onPeerCandidatesLoaded,
}: Props) {
  const [trendWeeks, setTrendWeeks] = useState<number>(4);

  const query = useQuery({
    queryKey: ["ranker", "store-dashboard", week, store, peerStore, trendWeeks],
    queryFn: async () => {
      const data = await fetchStoreDashboard({
        week,
        store,
        peerStore,
        trendWeeks,
      });
      if (data.peerCandidates) onPeerCandidatesLoaded(data.peerCandidates);
      return data;
    },
    staleTime: 60_000,
    enabled: !!store,
  });

  if (!store) {
    return (
      <EmptyState
        title="Pick a store"
        description="Use the Store dropdown above to choose one."
      />
    );
  }
  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Couldn't load store"
        description={(query.error as Error)?.message ?? "Try again."}
      />
    );
  }
  if (!query.data) return null;
  const data = query.data;

  if (!data.found) {
    return (
      <EmptyState
        title="No data for this store and week"
        description={`Store ${data.store} doesn't appear in week ${data.week}.`}
      />
    );
  }

  const m = data.metrics as Metrics;
  const pm = data.priorMetrics ?? null;
  const rd = rankDelta(data.rankMovement ?? null);
  const mom = data.momentum;

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex flex-col justify-between gap-2 p-5 sm:col-span-2 lg:col-span-1">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Store View
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-midnight">
              {fmtMetric("storeName", m.storeName) === "—"
                ? `Store ${data.store}`
                : m.storeName}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              GM: <span className="font-medium text-zinc-700">{m.gmName || "—"}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge tone="neutral">Store {data.store}</Badge>
              <Badge tone="neutral">Week {data.week}</Badge>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-zinc-600">
            {buildNarrative(data)}
          </p>
        </Card>

        <HeroStat
          label="Rank"
          value={fmtMetric("storeRank", m.storeRank)}
          delta={rd.text}
          deltaTone={rd.tone}
          big
        />
        <HeroStat
          label="Weekly Sales"
          value={fmtMetric("weeklySales", m.weeklySales)}
          delta={deltaText("weeklySales", m.weeklySales, pm?.weeklySales ?? null)}
          deltaTone={deltaClass("weeklySales", m.weeklySales, pm?.weeklySales ?? null)}
        />
        <HeroStat
          label="VOG Count"
          value={`${fmtMetric("vogCount", m.vogCount)} / 21`}
          delta={
            num(m.vogCount) === null
              ? "No prior data"
              : num(m.vogCount)! >= 21
                ? "On Target"
                : "Below Target"
          }
          deltaTone={
            num(m.vogCount) === null
              ? "warn"
              : num(m.vogCount)! >= 21
                ? "good"
                : num(m.vogCount)! >= 15
                  ? "warn"
                  : "bad"
          }
        />
      </div>

      {/* Momentum / Execution / Guest signals */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Momentum
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {(["sales", "labor", "guest"] as const).map((k) => {
              const value = mom?.[k] ?? "Stable";
              const tone =
                value === "Improving"
                  ? "good"
                  : value === "Softening" || value === "Rising"
                    ? "bad"
                    : "warn";
              return (
                <div
                  key={k}
                  className="rounded-md border border-zinc-100 bg-white p-3"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    {k}
                  </div>
                  <div
                    className={`mt-1 text-sm font-semibold ${toneTextClass(tone)}`}
                  >
                    {value}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="flex items-center gap-4 p-4">
          <ScoreRing score={data.executionScore ?? null} size={90} />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Execution Score
            </div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              Composite of labor, VOG count, complaints, and BSC training.
            </p>
            <div
              className={`mt-2 text-xs font-medium ${
                data.executionScore === null
                  ? "text-zinc-400"
                  : data.executionScore! >= 75
                    ? "text-emerald-600"
                    : data.executionScore! >= 50
                      ? "text-amber-600"
                      : "text-red-600"
              }`}
            >
              {data.executionScore === null
                ? "Not enough data"
                : data.executionScore! >= 75
                  ? "Strong execution"
                  : data.executionScore! >= 50
                    ? "Room to improve"
                    : "Needs attention"}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Guest Signals
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                VOG Week
              </div>
              <div className="mt-1 font-semibold text-midnight">
                {fmtMetric("vogWeek", m.vogWeek)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                VOG Count
              </div>
              <div className="mt-1 font-semibold text-midnight">
                {fmtMetric("vogCount", m.vogCount)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Complaints
              </div>
              <div
                className={`mt-1 font-semibold ${
                  (num(m.complaints) ?? 0) === 0
                    ? "text-emerald-600"
                    : (num(m.complaints) ?? 0) <= 3
                      ? "text-amber-600"
                      : "text-red-600"
                }`}
              >
                {fmtMetric("complaints", m.complaints)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* KPI scorecard */}
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Full Scorecard — Week {data.week}
          </div>
          <TrendPills active={trendWeeks} onChange={setTrendWeeks} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {KPI_LIST.map((k) => {
            const cur = m[k.key];
            const prior = pm?.[k.key] ?? null;
            const tone = deltaClass(k.key, cur, prior);
            const series = data.trends?.seriesByMetric?.[k.key] ?? [];
            return (
              <KpiCard
                key={k.key}
                label={k.label}
                value={fmtMetric(k.key, cur)}
                delta={deltaText(k.key, cur, prior)}
                tone={tone}
                series={series}
              />
            );
          })}
        </div>
      </div>

      {/* Peer comparison hint — only when a peer is bound */}
      {data.peer && data.peer.metrics && (
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Peer Snapshot — Store {data.selectedPeerStore}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Auto-matched by closest sales volume. Switch peers from the
            toolbar.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <PeerRow
              label="Weekly Sales"
              mine={money(m.weeklySales)}
              theirs={money(data.peer.metrics.weeklySales)}
            />
            <PeerRow
              label="Labor %"
              mine={fmtMetric("laborPct", m.laborPct)}
              theirs={fmtMetric("laborPct", data.peer.metrics.laborPct)}
            />
            <PeerRow
              label="VOG Count"
              mine={fmtMetric("vogCount", m.vogCount)}
              theirs={fmtMetric("vogCount", data.peer.metrics.vogCount)}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

function HeroStat({
  label,
  value,
  delta,
  deltaTone,
  big,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: "good" | "warn" | "bad";
  big?: boolean;
}) {
  return (
    <Card className="flex h-full flex-col justify-between p-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </div>
        <div
          className={`mt-2 font-semibold tracking-tight text-midnight ${
            big ? "text-4xl" : "text-2xl"
          }`}
        >
          {value}
        </div>
      </div>
      <div className={`mt-3 text-xs ${toneTextClass(deltaTone)}`}>{delta}</div>
    </Card>
  );
}

function PeerRow({
  label,
  mine,
  theirs,
}: {
  label: string;
  mine: string;
  theirs: string;
}) {
  return (
    <div className="rounded-md border border-zinc-100 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <div className="text-sm font-semibold text-midnight">{mine}</div>
        <div className="text-xs text-zinc-500">peer: {theirs}</div>
      </div>
    </div>
  );
}
