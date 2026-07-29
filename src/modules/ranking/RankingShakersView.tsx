// "Movers & Shakers" — the entities that climbed the most in period rank vs the
// prior period (e.g. P7 vs P6). A recognition board with a tier toggle: Stores
// (store, GM/DO/SDO, rank, spots gained) or DOs (DO, SDO, rank, spots gained).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket, ArrowUp } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import { fetchPeriodMovers, type PeriodMoverRow, type MoverTier } from "./api";

export function RankingShakersView() {
  const [limit, setLimit] = useState(11);
  const [tier, setTier] = useState<MoverTier>("store");
  const q = useQuery({
    queryKey: ["ranking-shakers", limit, tier],
    queryFn: () => fetchPeriodMovers(limit, tier),
    staleTime: 5 * 60_000,
  });
  const rows: PeriodMoverRow[] = q.data?.rows ?? [];
  const cur = q.data?.current ?? null;
  const prev = q.data?.previous ?? null;
  const official = q.data?.source === "official";
  const isDo = tier === "do";
  const pLabel = cur ? `P${cur.period}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-green-600 to-emerald-500 px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
            <Rocket className="h-6 w-6" />
          </span>
          <div>
            <div className="text-xl font-black tracking-tight">
              {isDo ? "DO " : ""}Movers &amp; Shakers
            </div>
            <div className="text-xs font-medium text-white/80">
              Biggest climbers in rank{cur ? ` · ${pLabel}${prev ? ` vs P${prev.period}` : ""}` : ""}
              {official && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-white/30">Official sheet</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<MoverTier>
            dense value={tier} onChange={setTier}
            options={[{ value: "store", label: "Stores" }, { value: "do", label: "DOs" }]}
          />
          <Segmented<string>
            dense value={String(limit)} onChange={(v) => setLimit(Number(v))}
            options={[{ value: "11", label: "Top 11" }, { value: "25", label: "25" }, { value: "50", label: "All" }]}
          />
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="No period-over-period movement yet" description="Needs two periods to compare — the newest period (uploaded sheet or live run) and the one before it. Upload the prior period's SOAR PTD RANKING, or run the ranker for both periods." />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  {isDo ? (
                    <>
                      <th className="px-3 py-2.5">DO</th>
                      <th className="px-3 py-2.5">SDO</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2.5">Store</th>
                      <th className="px-3 py-2.5">Location</th>
                      <th className="px-3 py-2.5">GM</th>
                      <th className="px-3 py-2.5">DO</th>
                      <th className="px-3 py-2.5">SDO</th>
                    </>
                  )}
                  <th className="px-3 py-2.5 text-right">{pLabel || "P"} Rank</th>
                  <th className="px-4 py-2.5 text-right">+/&minus; Last Period</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.store_number} className={cn("border-b border-zinc-50 last:border-b-0", i < 3 && "bg-emerald-50/40")}>
                    {isDo ? (
                      <>
                        <td className="px-3 py-2.5 font-semibold text-midnight">{r.name ?? "—"}</td>
                        <td className="px-3 py-2.5 text-zinc-500">{r.sdo_name ?? "—"}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 font-semibold text-midnight tabular-nums">#{r.store_number}</td>
                        <td className="px-3 py-2.5 text-zinc-700">{r.location ?? "—"}</td>
                        <td className="px-3 py-2.5 text-zinc-700">{r.gm ?? "—"}</td>
                        <td className="px-3 py-2.5 text-zinc-500">{r.do_name ?? "—"}</td>
                        <td className="px-3 py-2.5 text-zinc-500">{r.sdo_name ?? "—"}</td>
                      </>
                    )}
                    <td className="px-3 py-2.5 text-right font-semibold text-midnight tabular-nums">{r.rank ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700 tabular-nums">
                        <ArrowUp className="h-3.5 w-3.5" />{r.delta ?? "—"}
                      </span>
                      {r.prev_rank != null && r.rank != null && (
                        <div className="text-[11px] text-zinc-400 tabular-nums">{r.prev_rank} &rarr; {r.rank}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
