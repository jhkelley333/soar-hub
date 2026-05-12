// Ranker — FC Miss watchlist tab. Lists stores in the caller's scope
// where annualizedFcMiss > 0 for the selected week, sorted descending
// by miss size. Uses the existing /getWarRoom payload (FC miss is now
// surfaced on each portfolio row), so no extra Sheets calls needed.
//
// Route gating on /ranker already restricts visibility to do+, so any
// caller who can see this tab is implicitly DO and above.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchWarRoom } from "./api";
import { integer, money, pct } from "./format";
import type { PortfolioRow } from "./types";

interface Props {
  week: string;
  onDrillStore: (store: string) => void;
  onDrillH2H: (store: string) => void;
}

export function FcMissView({ week, onDrillStore, onDrillH2H }: Props) {
  const query = useQuery({
    queryKey: ["ranker", "war-room", week],
    queryFn: () => fetchWarRoom(week),
    staleTime: 60_000,
  });

  // Filter + sort happens client-side so this tab can ride on the
  // already-cached war-room payload when the user came from Portfolio.
  const missRows: PortfolioRow[] = useMemo(() => {
    if (!query.data) return [];
    return query.data.portfolioRows
      .filter((r) => r.annualizedFcMiss !== null && r.annualizedFcMiss > 0)
      .slice()
      .sort(
        (a, b) =>
          (b.annualizedFcMiss ?? 0) - (a.annualizedFcMiss ?? 0),
      );
  }, [query.data]);

  const totalMiss = useMemo(
    () => missRows.reduce((sum, r) => sum + (r.annualizedFcMiss ?? 0), 0),
    [missRows],
  );

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Couldn't load FC Miss data"
        description={(query.error as Error)?.message ?? "Try again."}
      />
    );
  }
  if (!query.data) return null;

  if (missRows.length === 0) {
    return (
      <EmptyState
        title={`No FC miss for week ${week}`}
        description="Every store in scope is at or above its FC target this week."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Stores with FC miss" value={String(missRows.length)} />
        <StatCard label="Total annualized miss" value={money(totalMiss)} />
        <StatCard
          label="Worst miss"
          value={money(missRows[0]?.annualizedFcMiss ?? null)}
        />
      </div>

      <Card className="overflow-x-auto">
        <SectionLabel>
          FC Miss Watchlist — Week {query.data.week}
        </SectionLabel>
        <table className="w-full min-w-[800px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2">Store</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">GM</th>
              <th className="px-3 py-2">Ann. FC Miss</th>
              <th className="px-3 py-2">Sales</th>
              <th className="px-3 py-2">% vs LY</th>
              <th className="px-3 py-2">Labor%</th>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {missRows.map((r) => (
              <tr
                key={r.store}
                className="border-t border-zinc-100 border-l-2 border-l-red-500"
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onDrillStore(r.store)}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {r.store}
                  </button>
                </td>
                <td className="px-3 py-2 text-zinc-700">{r.storeName || "—"}</td>
                <td className="px-3 py-2 text-zinc-700">{r.gmName || "—"}</td>
                <td className="px-3 py-2 font-semibold text-red-600">
                  {money(r.annualizedFcMiss)}
                </td>
                <td className="px-3 py-2 text-zinc-700">{money(r.weeklySales)}</td>
                <td className="px-3 py-2 text-zinc-700">{pct(r.vsLastYear)}</td>
                <td className="px-3 py-2 text-zinc-700">{pct(r.laborPct)}</td>
                <td className="px-3 py-2 text-zinc-700">{integer(r.storeRank)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onDrillH2H(r.store)}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    Compare
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-midnight">
        {value}
      </div>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-zinc-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </div>
  );
}
