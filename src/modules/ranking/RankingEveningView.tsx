// "Evening Growth" — the stores most up in EVENING-daypart sales vs last year
// (period-to-date), read from the latest KPI snapshot's daypart breakdown.
// Same board pattern as 7 UP, with a screenshot / PNG-ready Present slide.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Moon, Presentation } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import { fetchEveningGrowth, type SevenUpRow } from "./api";
import { SlideTable, PresentModal, type SlideCol } from "./present";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtUsd = (v: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

type EveningSlideRow = SevenUpRow & { pos: number };
const eveningCols: SlideCol<EveningSlideRow>[] = [
  { key: "pos", label: "#", align: "center", cell: (r) => r.pos, cellClassName: "font-bold" },
  { key: "store", label: "Store #", align: "center", cell: (r) => r.store_number, cellClassName: "bg-blue-100 font-semibold" },
  { key: "loc", label: "Location", cell: (r) => r.location ?? "—" },
  { key: "gm", label: "GM", cell: (r) => r.gm ?? "—" },
  { key: "do", label: "DO", cell: (r) => r.do_name ?? "—" },
  { key: "sdo", label: "SDO", cell: (r) => r.sdo_name ?? "—" },
  { key: "pct", label: "Evening % vs LY", align: "center", cell: (r) => fmtPct(r.pct_vs_ly), cellClassName: "bg-green-100 font-bold" },
];

export function RankingEveningView() {
  const [limit, setLimit] = useState(10);
  const [present, setPresent] = useState(false);
  const q = useQuery({
    queryKey: ["ranking-evening", limit],
    queryFn: () => fetchEveningGrowth(limit),
    staleTime: 5 * 60_000,
  });
  const rows: SevenUpRow[] = q.data?.rows ?? [];
  const asOf = q.data?.as_of ?? null;
  const period = q.data?.period ?? null;
  const anchored = q.data?.anchored ?? false;
  const pLabel = period ? `P${period}` : "";
  const slideRows: EveningSlideRow[] = rows.map((r, i) => ({ ...r, pos: i + 1 }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-500 px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
            <Moon className="h-6 w-6" />
          </span>
          <div>
            <div className="text-xl font-black tracking-tight">Evening Growth</div>
            <div className="text-xs font-medium text-white/80">
              Stores most up in Evening sales vs last year{pLabel ? ` · ${pLabel}` : ""}
              {anchored ? ` · period-ending ${fmtDate(asOf)}` : asOf ? ` · latest snapshot ${fmtDate(asOf)} (period in progress)` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<string>
            dense value={String(limit)} onChange={(v) => setLimit(Number(v))}
            options={[{ value: "10", label: "Top 10" }, { value: "25", label: "25" }, { value: "50", label: "All" }]}
          />
          <button
            onClick={() => setPresent(true)}
            disabled={!rows.length}
            className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/25 disabled:opacity-40"
          >
            <Presentation className="h-4 w-4" />Present
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="No Evening daypart data yet" description="The latest KPI snapshot didn't carry an Evening daypart breakdown. Once a snapshot with dayparts lands, the top movers show here." />
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
                  <th className="px-4 py-2.5 text-right">Evening % vs LY</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const top = i < 3;
                  return (
                    <tr key={r.store_number} className={cn("border-b border-zinc-50 last:border-b-0", top && "bg-indigo-50/40")}>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn(
                          "inline-grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold tabular-nums",
                          top ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-500",
                        )}>{i + 1}</span>
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

      <PresentModal open={present} onClose={() => setPresent(false)} filename="evening-growth" maxWidth="max-w-[960px]">
        <SlideTable
          title={`Evening Growth${pLabel ? ` · ${pLabel}` : ""}${anchored && asOf ? ` · period-ending ${fmtDate(asOf)}` : ""}`}
          columns={eveningCols}
          rows={slideRows}
          getKey={(r) => r.store_number}
        />
      </PresentModal>
    </div>
  );
}
