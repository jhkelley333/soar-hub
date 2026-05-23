// Region rollup — DO+ view of every store in their scope. Hero tile
// carries the regional ops index, the tier breakdown, and a 7d/30d/Qtr
// time-range toggle. Below, a tier filter strip and a list of stores
// sorted worst-tier first with score donut + trend + sparkline.
//
// PREVIEW: scores, tiers, trends, and sparklines are placeholder values
// derived deterministically from store IDs (see `./scoring`). Real
// scoring lands in a follow-up PR.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Clock } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { ScoreRing } from "@/shared/ui/ScoreRing";
import { TierBar, TierDot } from "@/shared/ui/Tier";
import { CupMark } from "@/shared/ui/CupMark";
import { cn } from "@/lib/cn";
import { fetchRegionRollup, type RegionStore } from "./api";
import type { Tier } from "@/shared/ui/Tier";

type TierFilter = "all" | "red" | "yellow" | "green";
type RangeFilter = "7d" | "30d" | "qtr";

const TIER_RANK: Record<Tier, number> = { red: 0, yellow: 1, green: 2 };

export function RegionPage() {
  const [tier, setTier] = useState<TierFilter>("all");
  const [range, setRange] = useState<RangeFilter>("7d");

  const query = useQuery({
    queryKey: ["region-rollup"],
    queryFn: fetchRegionRollup,
    staleTime: 60_000,
  });

  const sorted = useMemo(() => {
    const stores = query.data?.stores ?? [];
    return [...stores].sort((a, b) => {
      if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) {
        return TIER_RANK[a.tier] - TIER_RANK[b.tier];
      }
      return a.score - b.score; // within a tier, worst score first
    });
  }, [query.data?.stores]);

  const filtered = tier === "all" ? sorted : sorted.filter((s) => s.tier === tier);

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full">
      <AppHeader
        title={query.data?.scopeLabel ?? "Region"}
        subtitle={query.data?.scopeSummary ?? "Loading…"}
        trailing={
          <button
            type="button"
            className="text-midnight-500 hover:text-midnight-800"
            aria-label="Search stores"
          >
            <Search className="h-4 w-4" strokeWidth={2} />
          </button>
        }
      />

      {query.isLoading && (
        <div className="p-4 space-y-3">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="p-4">
          <EmptyState
            title="Couldn't load the region rollup"
            description={(query.error as Error)?.message ?? "Try again."}
          />
        </div>
      )}

      {query.data && (
        <>
          <HeroTile
            index={query.data.index}
            trend={query.data.trend}
            counts={query.data.counts}
            range={range}
            onRange={setRange}
          />

          <div className="px-4 pt-3 pb-2 sticky top-12 z-10 bg-surface-muted">
            <Segmented<TierFilter>
              value={tier}
              onChange={setTier}
              options={[
                { value: "all", label: "All", count: query.data.counts.all },
                { value: "red", label: "Red", count: query.data.counts.red, dot: "tier-red" },
                { value: "yellow", label: "Yellow", count: query.data.counts.yellow, dot: "tier-yellow" },
                { value: "green", label: "Green", count: query.data.counts.green, dot: "tier-green" },
              ]}
            />
            <div className="mt-2 flex items-center justify-between text-[11.5px] text-midnight-500">
              <span>
                Showing {filtered.length} of{" "}
                {tier === "all" ? query.data.counts.all : query.data.counts[tier]}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-midnight-600 hover:text-midnight-800"
              >
                <Filter className="h-3 w-3" strokeWidth={2} />
                District · Last visit
              </button>
            </div>
          </div>

          <div className="px-3 pb-6 space-y-1.5">
            {filtered.length === 0 && (
              <p className="text-center text-[12px] text-midnight-500 py-8">
                No stores in this tier.
              </p>
            )}
            {filtered.map((s) => (
              <StoreRow key={s.id} store={s} />
            ))}
          </div>

          <PreviewNote />
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Hero tile — dark midnight card with the regional ops index, tier breakdown,
// and a 7d/30d/Qtr selector. The cup mark watermark in the corner is a quiet
// brand nod, used here because it's the one place per screen where the app
// can carry its identity at full opacity.
// ----------------------------------------------------------------------------

function HeroTile({
  index,
  trend,
  counts,
  range,
  onRange,
}: {
  index: number;
  trend: number;
  counts: { all: number; green: number; yellow: number; red: number };
  range: RangeFilter;
  onRange: (r: RangeFilter) => void;
}) {
  const trendLabel =
    trend === 0 ? "tracking flat" : `${trend > 0 ? "+" : ""}${trend.toFixed(1)} vs last wk`;
  const pct = (n: number) =>
    counts.all === 0 ? 0 : Math.round((n / counts.all) * 100);
  return (
    <div className="px-4 pt-3">
      <div className="bg-midnight-900 text-white rounded-2xl p-4 relative overflow-hidden shadow-card">
        <div className="absolute -right-6 -top-6 opacity-10 rotate-12 pointer-events-none">
          <CupMark size={120} />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-accent-300 font-medium">
              This week
            </div>
            <div className="text-[26px] font-display font-semibold leading-none mt-1 tabular-nums">
              {index.toFixed(1)}
            </div>
            <div className="text-[11.5px] text-midnight-200 mt-0.5">
              Regional ops index · {trendLabel}
            </div>
          </div>
          <Segmented<RangeFilter>
            dense
            value={range}
            onChange={onRange}
            options={[
              { value: "7d", label: "7d" },
              { value: "30d", label: "30d" },
              { value: "qtr", label: "Qtr" },
            ]}
          />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <TierTile tier="green" label="Green" count={counts.green} pct={pct(counts.green)} />
          <TierTile tier="yellow" label="Yellow" count={counts.yellow} pct={pct(counts.yellow)} />
          <TierTile tier="red" label="Red" count={counts.red} pct={pct(counts.red)} />
        </div>
      </div>
    </div>
  );
}

function TierTile({
  tier,
  label,
  count,
  pct,
}: {
  tier: Tier;
  label: string;
  count: number;
  pct: number;
}) {
  return (
    <div className="bg-white/5 ring-1 ring-white/10 rounded-lg px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10.5px] text-midnight-200">
        <TierDot tier={tier} /> {label}
      </div>
      <div className="text-[20px] font-semibold tabular-nums mt-0.5">{count}</div>
      <div className="text-[10px] text-midnight-300">{pct}%</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Store row — one tappable card per store with the TierBar on the left,
// SDI / city header, DO + GM, last-visit + flag chips, and a ScoreRing +
// sparkline on the right.
// ----------------------------------------------------------------------------

function StoreRow({ store }: { store: RegionStore }) {
  return (
    <button
      type="button"
      className="relative w-full text-left bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card pl-4 pr-3 py-3 hover:ring-midnight-200 transition"
    >
      <TierBar tier={store.tier} />
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-medium text-midnight-500">
              SDI {store.sdi}
            </span>
            {store.city && (
              <>
                <span className="text-midnight-300">·</span>
                <span className="text-[13px] text-midnight-800 truncate">
                  {store.city}
                  {store.state ? `, ${store.state}` : ""}
                </span>
              </>
            )}
          </div>
          {(store.do || store.gm) && (
            <div className="mt-0.5 text-[11.5px] text-midnight-500 truncate">
              {[store.do && `DO ${store.do}`, store.gm && `GM ${store.gm}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-midnight-500">
            {store.districtCode && (
              <>
                <span className="font-mono">{store.districtCode}</span>
                <span className="text-midnight-300">·</span>
              </>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" strokeWidth={2} />
              last visit —
            </span>
            {store.openWorkOrders > 0 && (
              <>
                <span className="text-midnight-300">·</span>
                <span className="text-sonic-700 font-medium">
                  {store.openWorkOrders} flag{store.openWorkOrders === 1 ? "" : "s"}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-baseline gap-1">
            <ScoreRing value={Math.round(store.score)} tone={store.tier} size={40} />
            {store.trend !== 0 && (
              <span
                className={cn(
                  "text-[10.5px] font-medium tabular-nums",
                  store.trend > 0 ? "text-ok" : "text-bad",
                )}
              >
                {store.trend > 0 ? "+" : ""}
                {store.trend}
              </span>
            )}
          </div>
          <Sparkline data={store.sparkline} tier={store.tier} />
        </div>
      </div>
    </button>
  );
}

function Sparkline({ data, tier }: { data: number[]; tier: Tier }) {
  const w = 56;
  const h = 18;
  const p = 1.5;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((d, i) => {
      const x = p + (i * (w - p * 2)) / (data.length - 1);
      const y = h - p - ((d - min) / span) * (h - p * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color =
    tier === "green"
      ? "oklch(54% 0.14 155)"
      : tier === "yellow"
      ? "oklch(62% 0.14 75)"
      : "oklch(55% 0.18 25)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Single visible disclosure that the numbers on this page aren't real
// yet. Sits under the list so it doesn't compete with the data above.
function PreviewNote() {
  return (
    <div className="px-4 pb-8 pt-2">
      <p className="text-[10.5px] leading-snug text-midnight-400">
        Preview — store list is live data from your scope. Score, tier, trend,
        and the sparkline are placeholder values; real scoring will replace
        them once the formula lands.
      </p>
    </div>
  );
}
