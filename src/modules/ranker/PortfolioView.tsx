// Ranker — Portfolio tab. Reworked into the scored-card layout (the
// design the old Stores page used): a dark hero with the week's FC-miss
// summary + tier breakdown, a tier filter, and a ranked list of store
// cards. Stores are tiered by annualized FC miss (higher = worse) into
// red/yellow/green terciles and sorted worst-first. Tap a card to drill
// into Store View; "Compare" opens Head-to-Head.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { TierBar, TierDot, type Tier } from "@/shared/ui/Tier";
import { CupMark } from "@/shared/ui/CupMark";
import { cn } from "@/lib/cn";
import { fetchWarRoom } from "./api";
import { money } from "./format";
import type { PortfolioRow } from "./types";

interface Props {
  week: string;
  onDrillStore: (store: string) => void;
  onDrillH2H: (store: string) => void;
}

type TierFilter = "all" | "red" | "yellow" | "green";

const TIER_RANK: Record<Tier, number> = { red: 0, yellow: 1, green: 2 };
const TIER_TEXT: Record<Tier, string> = {
  red: "text-bad",
  yellow: "text-warn",
  green: "text-ok",
};

// FC miss: higher = worse. Tier the stores that have data into terciles
// (worst third red → best third green). Stores without FC-miss data are
// left untiered (neutral).
function buildTiers(rows: PortfolioRow[]): Map<string, Tier> {
  const withMiss = rows
    .filter((r) => r.annualizedFcMiss != null)
    .sort((a, b) => (b.annualizedFcMiss as number) - (a.annualizedFcMiss as number));
  const n = withMiss.length;
  const m = new Map<string, Tier>();
  withMiss.forEach((r, i) => {
    m.set(r.store, i < n / 3 ? "red" : i < (2 * n) / 3 ? "yellow" : "green");
  });
  return m;
}

export function PortfolioView({ week, onDrillStore, onDrillH2H }: Props) {
  const [tier, setTier] = useState<TierFilter>("all");

  const query = useQuery({
    queryKey: ["ranker", "war-room", week],
    queryFn: () => fetchWarRoom(week),
    staleTime: 60_000,
  });

  const tiers = useMemo(
    () => buildTiers(query.data?.portfolioRows ?? []),
    [query.data?.portfolioRows],
  );

  const sorted = useMemo(() => {
    const rows = query.data?.portfolioRows ?? [];
    return [...rows].sort((a, b) => {
      const ta = tiers.get(a.store);
      const tb = tiers.get(b.store);
      const ra = ta ? TIER_RANK[ta] : 3;
      const rb = tb ? TIER_RANK[tb] : 3;
      if (ra !== rb) return ra - rb; // worst tier first
      return (b.annualizedFcMiss ?? -Infinity) - (a.annualizedFcMiss ?? -Infinity);
    });
  }, [query.data?.portfolioRows, tiers]);

  const counts = useMemo(() => {
    const c = { all: 0, red: 0, yellow: 0, green: 0 };
    for (const t of tiers.values()) {
      c[t]++;
      c.all++;
    }
    return c;
  }, [tiers]);

  const avgMiss = useMemo(() => {
    const vals = (query.data?.portfolioRows ?? [])
      .map((r) => r.annualizedFcMiss)
      .filter((v): v is number => v != null);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }, [query.data?.portfolioRows]);

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Couldn't load portfolio"
        description={(query.error as Error)?.message ?? "Try again."}
      />
    );
  }
  if (!query.data || query.data.storeCount === 0) {
    return (
      <EmptyState
        title="No stores in your scope"
        description="Ask your admin to assign you a region, area, or district."
      />
    );
  }

  const filtered =
    tier === "all"
      ? sorted
      : sorted.filter((r) => tiers.get(r.store) === tier);

  return (
    <div className="mx-auto max-w-xl space-y-3">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-midnight-900 p-4 text-white shadow-card">
        <div className="pointer-events-none absolute -right-6 -top-6 rotate-12 opacity-10">
          <CupMark size={120} />
        </div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-accent-300">
          FC miss · Week {query.data.week}
        </div>
        <div className="mt-1 text-[26px] font-display font-semibold leading-none tabular-nums">
          {avgMiss == null ? "—" : money(avgMiss)}
        </div>
        <div className="mt-0.5 text-[11.5px] text-midnight-200">
          Avg annualized FC miss · {counts.all} stores ranked
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <TierTile tier="green" count={counts.green} all={counts.all} />
          <TierTile tier="yellow" count={counts.yellow} all={counts.all} />
          <TierTile tier="red" count={counts.red} all={counts.all} />
        </div>
      </div>

      {/* Tier filter */}
      <Segmented<TierFilter>
        value={tier}
        onChange={setTier}
        options={[
          { value: "all", label: "All", count: counts.all },
          { value: "red", label: "Red", count: counts.red, dot: "tier-red" },
          { value: "yellow", label: "Yellow", count: counts.yellow, dot: "tier-yellow" },
          { value: "green", label: "Green", count: counts.green, dot: "tier-green" },
        ]}
      />

      {/* Ranked cards */}
      <div className="space-y-1.5">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-midnight-500">
            No stores in this tier.
          </p>
        ) : (
          filtered.map((row) => (
            <StoreCard
              key={row.store}
              row={row}
              tier={tiers.get(row.store) ?? null}
              onDrillStore={onDrillStore}
              onDrillH2H={onDrillH2H}
            />
          ))
        )}
      </div>

      <p className="px-1 pb-4 pt-1 text-[10.5px] leading-snug text-midnight-400">
        Tiers are FC-miss terciles within your scope (worst third red).
        Absolute thresholds can replace this once you set targets.
      </p>
    </div>
  );
}

function TierTile({ tier, count, all }: { tier: Tier; count: number; all: number }) {
  const label = tier === "green" ? "Green" : tier === "yellow" ? "Yellow" : "Red";
  const pct = all === 0 ? 0 : Math.round((count / all) * 100);
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-2 ring-1 ring-white/10">
      <div className="flex items-center gap-1.5 text-[10.5px] text-midnight-200">
        <TierDot tier={tier} /> {label}
      </div>
      <div className="mt-0.5 text-[20px] font-semibold tabular-nums">{count}</div>
      <div className="text-[10px] text-midnight-300">{pct}%</div>
    </div>
  );
}

function StoreCard({
  row,
  tier,
  onDrillStore,
  onDrillH2H,
}: {
  row: PortfolioRow;
  tier: Tier | null;
  onDrillStore: (s: string) => void;
  onDrillH2H: (s: string) => void;
}) {
  return (
    <div className="relative rounded-xl bg-surface pl-4 pr-3 py-3 shadow-card ring-1 ring-midnight-100">
      {tier && <TierBar tier={tier} />}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onDrillStore(row.store)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-medium text-midnight-500">
              #{row.store}
            </span>
            {row.storeName && (
              <>
                <span className="text-midnight-300">·</span>
                <span className="truncate text-[13px] text-midnight-800">
                  {row.storeName}
                </span>
              </>
            )}
          </div>
          {row.gmName && (
            <div className="mt-0.5 truncate text-[11.5px] text-midnight-500">
              GM {row.gmName}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-midnight-500">
            <span>Rank {row.storeRank == null ? "—" : `#${row.storeRank}`}</span>
            {row.rankChange != null && row.rankChange !== 0 && (
              <span
                className={cn(
                  "font-medium tabular-nums",
                  row.rankChange < 0 ? "text-ok" : "text-bad",
                )}
              >
                {row.rankChange < 0 ? "▲" : "▼"} {Math.abs(row.rankChange)}
              </span>
            )}
          </div>
        </button>
        <div className="flex flex-col items-end gap-1">
          <div className="text-[9.5px] font-semibold uppercase tracking-wide text-midnight-400">
            FC miss
          </div>
          <div
            className={cn(
              "text-[16px] font-semibold tabular-nums",
              tier ? TIER_TEXT[tier] : "text-midnight-700",
            )}
          >
            {money(row.annualizedFcMiss)}
          </div>
          <button
            type="button"
            onClick={() => onDrillH2H(row.store)}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            Compare
          </button>
        </div>
      </div>
    </div>
  );
}
