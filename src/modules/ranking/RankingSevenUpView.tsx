// "7 UP in Sales" — the leaderboard of stores most up in sales vs last year for
// the current period (period-to-date by default; week-to-date optional). Reads
// pctVsLy straight off the latest ranking run, with each store's GM / DO / SDO.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import { fetchSevenUp, type RankScope, type SevenUpRow } from "./api";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtUsd = (v: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export function RankingSevenUpView() {
  const [scope, setScope] = useState<RankScope>("ptd");
  const [limit, setLimit] = useState(7);
  const q = useQuery({
    queryKey: ["ranking-sevenup", scope, limit],
    queryFn: () => fetchSevenUp(scope, limit),
    staleTime: 5 * 60_000,
  });
  const rows: SevenUpRow[] = q.data?.rows ?? [];
  const run = q.data?.run ?? null;

  return (
    <div className="space-y-4">
      {/* Header — the 7 UP theme, kept tasteful */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-emerald-600 to-green-500 px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
            <TrendingUp className="h-6 w-6" />
          </span>
          <div>
            <div className="text-xl font-black tracking-tight">
              7&nbsp;UP <span className="font-semibold text-white/90">in Sales</span>
            </div>
            <div className="text-xs font-medium text-white/80">
              Stores most up vs last year{run ? ` · P${run.period}${scope === "wtd" ? ` W${run.week}` : ""} · wk ending ${fmtDate(run.week_ending)}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<RankScope>
            dense value={scope} onChange={setScope}
            options={[{ value: "ptd", label: "Period" }, { value: "wtd", label: "Week" }]}
          />
          <Segmented<string>
            dense value={String(limit)} onChange={(v) => setLimit(Number(v))}
            options={[{ value: "7", label: "Top 7" }, { value: "15", label: "15" }, { value: "50", label: "All" }]}
          />
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="No sales-vs-last-year data yet" description="Run the ranker (Run now on the Ranking tab) once the KPI feed has this period's sales." />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <th className="px-4 py-2.5 text-center">#</th>
                  <th className="px-3 py-2.5">Store</th>
                  <th className="px-3 py-2.5">Location</th>
                  <th className="px-3 py-2.5">GM</th>
                  <th className="px-3 py-2.5">DO</th>
                  <th className="px-3 py-2.5">SDO</th>
                  <th className="px-4 py-2.5 text-right">% vs Last Year</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rank = i + 1;
                  const top = rank <= 3;
                  return (
                    <tr key={r.store_number} className={cn("border-b border-zinc-50 last:border-b-0", top && "bg-emerald-50/40")}>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn(
                          "inline-grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold tabular-nums",
                          top ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-500",
                        )}>{rank}</span>
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-midnight tabular-nums">#{r.store_number}</td>
                      <td className="px-3 py-2.5 text-zinc-700">{r.location ?? "—"}</td>
                      <td className="px-3 py-2.5 text-zinc-700">{r.gm ?? "—"}</td>
                      <td className="px-3 py-2.5 text-zinc-500">{r.do_name ?? "—"}</td>
                      <td className="px-3 py-2.5 text-zinc-500">{r.sdo_name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={cn("font-bold tabular-nums", (r.pct_vs_ly ?? 0) >= 0 ? "text-emerald-700" : "text-red-600")}>
                          {fmtPct(r.pct_vs_ly)}
                        </span>
                        {r.sales != null && r.ly_sales != null && (
                          <div className="text-[11px] text-zinc-400 tabular-nums">{fmtUsd(r.sales)} vs {fmtUsd(r.ly_sales)}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
