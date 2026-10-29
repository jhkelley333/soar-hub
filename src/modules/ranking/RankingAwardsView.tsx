// Year-in-Review Awards — aggregates P1–P10 official SOAR ranking data and
// surfaces award winners across store and DO categories.
import { useQuery } from "@tanstack/react-query";
import { Trophy, TrendingUp, Star, Medal, Award, Percent } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import {
  fetchAwards,
  type AwardCategory,
  type AwardStoreRow,
  type AwardLeaderRow,
} from "./api";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  trophy: Trophy,
  "trending-up": TrendingUp,
  star: Star,
  medal: Medal,
  award: Award,
  percent: Percent,
};

const PLACE_COLORS = [
  "bg-amber-400 text-white",
  "bg-zinc-300 text-zinc-800",
  "bg-orange-400 text-white",
];
const PLACE_LABELS = ["1st", "2nd", "3rd"];

function pct(v: number | null) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function rank(v: number | null) {
  return v == null ? "—" : `#${v}`;
}

function StoreAwardCard({ award }: { award: AwardCategory<AwardStoreRow> }) {
  const Icon = ICON_MAP[award.icon] ?? Trophy;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <div className="font-semibold text-zinc-900">{award.label}</div>
          <div className="text-xs text-zinc-500">{award.description}</div>
        </div>
      </div>
      {award.podium.length === 0 ? (
        <div className="px-4 py-4 text-sm text-zinc-400">No data available for this award.</div>
      ) : (
        <div className="divide-y divide-zinc-50">
          {award.podium.map((s, i) => (
            <div key={s.store_number} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={`grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold ${PLACE_COLORS[i] ?? "bg-zinc-100 text-zinc-500"}`}
              >
                {PLACE_LABELS[i] ?? i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-zinc-900">Store #{s.store_number}</span>
                  {s.location && <span className="truncate text-xs text-zinc-500">{s.location}</span>}
                </div>
                {s.gm && <div className="text-xs text-zinc-400">GM: {s.gm}</div>}
              </div>
              <div className="text-right text-xs text-zinc-500">
                {award.id === "store_of_year" && s.avg_rank != null && (
                  <span>Avg {s.avg_rank.toFixed(1)}</span>
                )}
                {award.id === "most_consistent" && (
                  <span>{s.top5_count} × top 5</span>
                )}
                {award.id === "most_improved" && s.rank_delta != null && (
                  <span>+{s.rank_delta} spots</span>
                )}
                {award.id === "sales_growth" && (
                  <span>{pct(s.best_pct)}{s.best_pct_period ? ` (P${s.best_pct_period})` : ""}</span>
                )}
                {award.id === "number_one" && (
                  <span>{s.top1_count} × #1</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="px-4 pb-3 pt-1 text-[11px] text-zinc-400">Ranked {award.sort_note}</div>
    </div>
  );
}

function LeaderAwardCard({ award }: { award: AwardCategory<AwardLeaderRow> }) {
  const Icon = ICON_MAP[award.icon] ?? Award;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-200">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <div className="font-semibold text-zinc-900">{award.label}</div>
          <div className="text-xs text-zinc-500">{award.description}</div>
        </div>
      </div>
      {award.podium.length === 0 ? (
        <div className="px-4 py-4 text-sm text-zinc-400">No data available for this award.</div>
      ) : (
        <div className="divide-y divide-zinc-50">
          {award.podium.map((l, i) => (
            <div key={`${l.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={`grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold ${PLACE_COLORS[i] ?? "bg-zinc-100 text-zinc-500"}`}
              >
                {PLACE_LABELS[i] ?? i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-zinc-900">{l.name}</div>
                {l.sdo_name && <div className="text-xs text-zinc-400">SDO: {l.sdo_name}</div>}
              </div>
              <div className="text-right text-xs text-zinc-500">
                {award.id === "do_of_year" && l.avg_rank != null && (
                  <><span>Avg {l.avg_rank.toFixed(1)}</span><br /><span>{rank(l.best_rank)} best</span></>
                )}
                {award.id === "do_most_improved" && l.rank_delta != null && (
                  <span>+{l.rank_delta} spots</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="px-4 pb-3 pt-1 text-[11px] text-zinc-400">Ranked {award.sort_note}</div>
    </div>
  );
}

export function RankingAwardsView() {
  const q = useQuery({
    queryKey: ["ranking-awards"],
    queryFn: fetchAwards,
    staleTime: 10 * 60_000,
  });

  const data = q.data;
  const periods = data?.periods ?? [];
  const pLabel = periods.length
    ? periods.length === 1
      ? `P${periods[0]}`
      : `P${periods[0]}–P${periods[periods.length - 1]}`
    : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-400 px-5 py-4 text-white shadow-sm">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
          <Trophy className="h-6 w-6" />
        </span>
        <div>
          <div className="text-xl font-black tracking-tight">Year-in-Review Awards</div>
          <div className="text-xs font-medium text-white/80">
            Best &amp; awards based on all Hub data
            {pLabel && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-white/30">{pLabel}</span>}
          </div>
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-52 w-full" />)}
        </div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load awards" description={(q.error as Error)?.message ?? "Try again."} />
      ) : !periods.length ? (
        <EmptyState
          title="No official period data yet"
          description="Upload official SOAR PTD RANKING sheets for P1–P10 to generate awards."
        />
      ) : (
        <>
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Store Awards</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(data?.store_awards ?? []).map((a) => (
                <StoreAwardCard key={a.id} award={a} />
              ))}
            </div>
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Leader Awards</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {(data?.leader_awards ?? []).map((a) => (
                <LeaderAwardCard key={a.id} award={a} />
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-400">
            Awards are based on {periods.length} official period{periods.length !== 1 ? "s" : ""} ({pLabel}).
            Stores must appear in at least 2 periods to qualify for rank-based awards.
          </p>
        </>
      )}
    </div>
  );
}
