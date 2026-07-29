// "Movers & Shakers" — the stores that climbed the most in period rank vs the
// prior period (e.g. P6 vs P5). A recognition board: store, GM/DO/SDO, this
// period's rank, and the spots gained.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket, ArrowUp } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import { fetchPeriodMovers, type PeriodMoverRow } from "./api";

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export function RankingShakersView() {
  const [limit, setLimit] = useState(11);
  const q = useQuery({
    queryKey: ["ranking-shakers", limit],
    queryFn: () => fetchPeriodMovers(limit),
    staleTime: 5 * 60_000,
  });
  const rows: PeriodMoverRow[] = q.data?.rows ?? [];
  const cur = q.data?.current ?? null;
  const prev = q.data?.previous ?? null;
  const pLabel = cur ? `P${cur.period}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-green-600 to-emerald-500 px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
            <Rocket className="h-6 w-6" />
          </span>
          <div>
            <div className="text-xl font-black tracking-tight">Movers &amp; Shakers</div>
            <div className="text-xs font-medium text-white/80">
              Biggest climbers in rank{cur ? ` · ${pLabel}${prev ? ` vs P${prev.period}` : ""} · wk ending ${fmtDate(cur.week_ending)}` : ""}
            </div>
          </div>
        </div>
        <Segmented<string>
          dense value={String(limit)} onChange={(v) => setLimit(Number(v))}
          options={[{ value: "11", label: "Top 11" }, { value: "25", label: "25" }, { value: "50", label: "All" }]}
        />
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="No period-over-period movement yet" description="Needs a completed run in two periods to compare. Run the ranker once this period's board is in." />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <th className="px-3 py-2.5">Store</th>
                  <th className="px-3 py-2.5">Location</th>
                  <th className="px-3 py-2.5">GM</th>
                  <th className="px-3 py-2.5">DO</th>
                  <th className="px-3 py-2.5">SDO</th>
                  <th className="px-3 py-2.5 text-right">{pLabel || "P"} Rank</th>
                  <th className="px-4 py-2.5 text-right">+/&minus; Last Period</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.store_number} className={cn("border-b border-zinc-50 last:border-b-0", i < 3 && "bg-emerald-50/40")}>
                    <td className="px-3 py-2.5 font-semibold text-midnight tabular-nums">#{r.store_number}</td>
                    <td className="px-3 py-2.5 text-zinc-700">{r.location ?? "—"}</td>
                    <td className="px-3 py-2.5 text-zinc-700">{r.gm ?? "—"}</td>
                    <td className="px-3 py-2.5 text-zinc-500">{r.do_name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-zinc-500">{r.sdo_name ?? "—"}</td>
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
