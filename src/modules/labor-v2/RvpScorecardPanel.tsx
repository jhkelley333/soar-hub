// RVP Scorecard — each region's Hours Over Chart averaged over the last N
// completed fiscal weeks, credit-adjusted so it matches the labor cards. Two
// figures per RVP: avg per store (the Hrs/Unit "efficiency" number, fair across
// differently-sized regions) and the region total. Cross-region leadership view.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "@/shared/ui/Segmented";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchRvpScorecard, type RvpScorecardRow } from "./api";

const fmtHrs = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}h`);
const fmtWeekEnd = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const hrsColor = (v: number | null) =>
  v == null ? "text-zinc-400" : v > 0 ? "text-red-600" : "text-emerald-600";

type SortKey = "per_store" | "total" | "name";

export function RvpScorecardPanel() {
  const [weeks, setWeeks] = useState(4);
  const [sort, setSort] = useState<SortKey>("per_store");
  const q = useQuery({
    queryKey: ["rvp-scorecard", weeks],
    queryFn: () => fetchRvpScorecard(weeks),
  });

  const rows = useMemo(() => {
    const list = [...(q.data?.rvps ?? [])];
    const val = (r: RvpScorecardRow) =>
      sort === "total" ? r.avg_hours_over_total : r.avg_hours_over_per_store;
    if (sort === "name") return list.sort((a, b) => (a.rvp_name ?? a.region).localeCompare(b.rvp_name ?? b.region));
    return list.sort((a, b) => (val(b) ?? -Infinity) - (val(a) ?? -Infinity));
  }, [q.data, sort]);

  const weekEnds = q.data?.weeks ?? [];

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-56 w-full" /></div>;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;
  if (!rows.length) return <EmptyState title="No regions in scope" description="No labor data for the selected window yet." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-zinc-200">
        <div>
          <div className="text-sm font-semibold text-midnight">RVP scorecard · Hours Over Chart</div>
          <div className="text-xs text-zinc-500">
            Average of each region's <strong className="text-midnight">week-to-date Hours Over Chart</strong> over the last{" "}
            {weeks} completed fiscal weeks — credit-adjusted, so it matches the labor cards.
            {q.data?.anchor ? <> Latest data {fmtWeekEnd(q.data.anchor)}.</> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<string> value={String(weeks)} onChange={(v) => setWeeks(Number(v))}
            options={[{ value: "4", label: "4 wks" }, { value: "8", label: "8 wks" }, { value: "12", label: "12 wks" }]} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-zinc-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-400">
              <Th onClick={() => setSort("name")} active={sort === "name"} className="pl-4">RVP · Region</Th>
              <Th className="text-right">Stores</Th>
              <Th onClick={() => setSort("per_store")} active={sort === "per_store"} className="text-right" title="Average positive hours over chart per store, per week">
                Avg hrs over / store
              </Th>
              <Th onClick={() => setSort("total")} active={sort === "total"} className="text-right" title="Average of the region's total weekly hours over chart">
                Avg region total
              </Th>
              {weekEnds.map((w) => (
                <th key={w} className="px-2 py-2 text-right text-[11px] font-medium tabular-nums text-zinc-400" title={`Week ending ${w} — hrs over / store`}>
                  wk {fmtWeekEnd(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r) => (
              <tr key={r.region} className="hover:bg-zinc-50/60">
                <td className="py-2.5 pl-4 pr-2">
                  <div className="font-semibold text-midnight">{r.rvp_name ?? "—"}</div>
                  <div className="text-xs text-zinc-400">{r.region}{r.weeks_with_data < weeks ? ` · ${r.weeks_with_data}/${weeks} wks` : ""}</div>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-zinc-500">{r.stores}</td>
                <td className={cn("px-2 py-2.5 text-right font-semibold tabular-nums", hrsColor(r.avg_hours_over_per_store))}>
                  {fmtHrs(r.avg_hours_over_per_store)}
                </td>
                <td className={cn("px-2 py-2.5 text-right tabular-nums", hrsColor(r.avg_hours_over_total))}>
                  {fmtHrs(r.avg_hours_over_total)}
                </td>
                {weekEnds.map((w) => {
                  const wk = r.weekly.find((x) => x.weekEnd === w);
                  return (
                    <td key={w} className={cn("px-2 py-2.5 text-right text-xs tabular-nums", hrsColor(wk?.perStore ?? null))}>
                      {fmtHrs(wk?.perStore ?? null)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-zinc-400">
        <strong>Avg hrs over / store</strong> = the Hrs/Unit metric from the region cards (each week: the sum of over-chart
        stores' hours ÷ every store), averaged across the weeks — a size-fair "efficiency" read.{" "}
        <strong>Avg region total</strong> = the region's whole-week hours over chart, averaged. Red = over chart, green = on/under.
        Labor credits (training / PTO / No-GM / GM support) are already subtracted.
      </p>
    </div>
  );
}

function Th({ children, onClick, active, className, title }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean; className?: string; title?: string;
}) {
  return (
    <th title={title}
      className={cn("px-2 py-2 font-medium", onClick && "cursor-pointer select-none hover:text-zinc-600", active && "text-accent-700", className)}
      onClick={onClick}>
      {children}{onClick && active ? " ↓" : ""}
    </th>
  );
}
