// Ranker — Portfolio tab. Shows every store in the caller's scope for
// the selected week: averages, coaching priorities, rank movers, and
// the full portfolio table. Clicking a store number drills into either
// Store View or Head-to-Head (caller wires the callbacks).

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchWarRoom } from "./api";
import { integer, money, pct } from "./format";
import type { PortfolioRow } from "./types";

interface Props {
  week: string;
  onDrillStore: (store: string) => void;
  onDrillH2H: (store: string) => void;
}

const PRIORITY_TONE: Record<"HIGH" | "MED" | "LOW", "danger" | "warning" | "success"> = {
  HIGH: "danger",
  MED: "warning",
  LOW: "success",
};

export function PortfolioView({ week, onDrillStore, onDrillH2H }: Props) {
  const query = useQuery({
    queryKey: ["ranker", "war-room", week],
    queryFn: () => fetchWarRoom(week),
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
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
  if (!query.data) return null;
  const data = query.data;

  if (data.storeCount === 0) {
    return (
      <EmptyState
        title="No stores in your scope"
        description="Ask your admin to assign you a region, area, or district."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Stores in scope" value={String(data.storeCount)} />
        <StatCard label="Avg Weekly Sales" value={money(data.avgWeeklySales)} />
        <StatCard label="Avg Labor %" value={pct(data.avgLaborPct)} />
        <StatCard label="Avg VOG Count" value={integer(data.avgVogCount)} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="overflow-x-auto">
          <SectionLabel>Coaching Priorities</SectionLabel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2">Store</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Level</th>
                <th className="px-4 py-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {data.coachingPriorities.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-500">
                    No priority flags.
                  </td>
                </tr>
              )}
              {data.coachingPriorities.map((r) => (
                <tr key={r.store} className="border-t border-zinc-100">
                  <td className="px-4 py-2">
                    <StoreLink store={r.store} onClick={onDrillStore} />
                  </td>
                  <td className="px-4 py-2 text-zinc-700">{r.storeName || "—"}</td>
                  <td className="px-4 py-2">
                    <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-500">{r.issues}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto">
          <SectionLabel>Rank Movers ↑</SectionLabel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2">Store</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">+Rank</th>
                <th className="px-4 py-2">Now</th>
              </tr>
            </thead>
            <tbody>
              {data.topImprovers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-500">
                    No improvers.
                  </td>
                </tr>
              )}
              {data.topImprovers.map((r) => (
                <tr key={r.store} className="border-t border-zinc-100">
                  <td className="px-4 py-2">
                    <StoreLink store={r.store} onClick={onDrillStore} />
                  </td>
                  <td className="px-4 py-2 text-zinc-700">{r.storeName || "—"}</td>
                  <td className="px-4 py-2 font-medium text-emerald-600">
                    ▼ {Math.abs(r.rankChange)}
                  </td>
                  <td className="px-4 py-2 text-zinc-700">{integer(r.currentRank)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto">
          <SectionLabel>Rank Movers ↓</SectionLabel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2">Store</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">−Rank</th>
                <th className="px-4 py-2">Now</th>
              </tr>
            </thead>
            <tbody>
              {data.rankDecliners.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-500">
                    No decliners.
                  </td>
                </tr>
              )}
              {data.rankDecliners.map((r) => (
                <tr key={r.store} className="border-t border-zinc-100">
                  <td className="px-4 py-2">
                    <StoreLink store={r.store} onClick={onDrillStore} />
                  </td>
                  <td className="px-4 py-2 text-zinc-700">{r.storeName || "—"}</td>
                  <td className="px-4 py-2 font-medium text-red-600">
                    ▲ {Math.abs(r.rankChange)}
                  </td>
                  <td className="px-4 py-2 text-zinc-700">{integer(r.currentRank)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <SectionLabel>Full Portfolio — Week {data.week}</SectionLabel>
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2">Store</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">GM</th>
              <th className="px-3 py-2">Sales</th>
              <th className="px-3 py-2">% vs LY</th>
              <th className="px-3 py-2">Labor%</th>
              <th className="px-3 py-2">VOG</th>
              <th className="px-3 py-2">Complaints</th>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">Δ Rank</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {data.portfolioRows.map((r) => (
              <PortfolioRowEl
                key={r.store}
                row={r}
                onDrillStore={onDrillStore}
                onDrillH2H={onDrillH2H}
              />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function PortfolioRowEl({
  row,
  onDrillStore,
  onDrillH2H,
}: {
  row: PortfolioRow;
  onDrillStore: (s: string) => void;
  onDrillH2H: (s: string) => void;
}) {
  const top = row.storeRank !== null && row.storeRank <= 5;
  const risk =
    (row.laborPct !== null && row.laborPct > 30) ||
    (row.complaints !== null && row.complaints > 5);

  const laborCls =
    row.laborPct !== null && row.laborPct > 30
      ? "text-red-600"
      : row.laborPct !== null && row.laborPct <= 26
        ? "text-emerald-600"
        : "text-zinc-700";
  const vogCls =
    row.vogCount !== null && row.vogCount >= 21
      ? "text-emerald-600"
      : row.vogCount !== null && row.vogCount < 10
        ? "text-red-600"
        : "text-amber-600";

  return (
    <tr
      className={cn(
        "border-t border-zinc-100",
        top && "border-l-2 border-l-emerald-500",
        risk && !top && "border-l-2 border-l-red-500",
      )}
    >
      <td className="px-3 py-2">
        <StoreLink store={row.store} onClick={onDrillStore} />
      </td>
      <td className="px-3 py-2 text-zinc-700">{row.storeName || "—"}</td>
      <td className="px-3 py-2 text-zinc-700">{row.gmName || "—"}</td>
      <td className="px-3 py-2 text-zinc-700">{money(row.weeklySales)}</td>
      <td className="px-3 py-2 text-zinc-700">{pct(row.vsLastYear)}</td>
      <td className={`px-3 py-2 ${laborCls}`}>{pct(row.laborPct)}</td>
      <td className={`px-3 py-2 ${vogCls}`}>{integer(row.vogCount)}</td>
      <td className="px-3 py-2">
        {row.complaints === 0 ? (
          <Badge tone="success">0</Badge>
        ) : (
          <span className="text-zinc-700">{integer(row.complaints)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-zinc-700">{integer(row.storeRank)}</td>
      <td className="px-3 py-2">
        {row.rankChange === null ? (
          <span className="text-zinc-400">—</span>
        ) : row.rankChange < 0 ? (
          <span className="font-medium text-emerald-600">
            ▼ {Math.abs(row.rankChange)}
          </span>
        ) : row.rankChange > 0 ? (
          <span className="font-medium text-red-600">▲ {row.rankChange}</span>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => onDrillH2H(row.store)}
          className="text-xs font-medium text-accent hover:underline"
        >
          Compare
        </button>
      </td>
    </tr>
  );
}

function StoreLink({
  store,
  onClick,
}: {
  store: string;
  onClick: (s: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(store)}
      className="text-sm font-medium text-accent hover:underline"
    >
      {store}
    </button>
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
