// "Movers & Shakers" — the biggest climbers in period rank vs the prior period
// (e.g. P7 vs P6). Shows Store and DO movers side by side (like the printed
// slide), and a Present button opens a screenshot / PNG-ready version.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket, Presentation } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { fetchPeriodMovers, type PeriodMoverRow } from "./api";
import { SlideTable, PresentModal, type SlideCol } from "./present";

const deltaCell = (r: PeriodMoverRow) => (r.delta == null ? "—" : `+${r.delta}`);

export function RankingShakersView() {
  const [limit, setLimit] = useState(11);
  const [present, setPresent] = useState(false);
  const storeQ = useQuery({
    queryKey: ["ranking-shakers", "store", limit],
    queryFn: () => fetchPeriodMovers(limit, "store"),
    staleTime: 5 * 60_000,
  });
  const doQ = useQuery({
    queryKey: ["ranking-shakers", "do", limit],
    queryFn: () => fetchPeriodMovers(limit, "do"),
    staleTime: 5 * 60_000,
  });

  const storeRows: PeriodMoverRow[] = storeQ.data?.rows ?? [];
  const doRows: PeriodMoverRow[] = doQ.data?.rows ?? [];
  const cur = storeQ.data?.current ?? doQ.data?.current ?? null;
  const prev = storeQ.data?.previous ?? doQ.data?.previous ?? null;
  const official = storeQ.data?.source === "official" || doQ.data?.source === "official";
  const pLabel = cur ? `P${cur.period}` : "";
  const rankLabel = `${pLabel || "P"} Rank`;

  const storeCols: SlideCol<PeriodMoverRow>[] = [
    { key: "store", label: "Store #", align: "center", cell: (r) => r.store_number, cellClassName: "bg-blue-100 font-semibold" },
    { key: "loc", label: "Location", cell: (r) => r.location ?? "—" },
    { key: "gm", label: "GM", cell: (r) => r.gm ?? "—" },
    { key: "do", label: "DO", cell: (r) => r.do_name ?? "—" },
    { key: "sdo", label: "SDO", cell: (r) => r.sdo_name ?? "—" },
    { key: "rank", label: rankLabel, align: "center", cell: (r) => r.rank ?? "—", cellClassName: "font-bold" },
    { key: "delta", label: "+/- Last Period Rank", align: "center", cell: deltaCell, cellClassName: "bg-green-100 font-bold" },
  ];
  const doCols: SlideCol<PeriodMoverRow>[] = [
    { key: "do", label: "DO", cell: (r) => r.name ?? "—", cellClassName: "font-semibold" },
    { key: "sdo", label: "SDO", cell: (r) => r.sdo_name ?? "—" },
    { key: "rank", label: rankLabel, align: "center", cell: (r) => r.rank ?? "—", cellClassName: "font-bold" },
    { key: "delta", label: "+/- Last Period Rank", align: "center", cell: deltaCell, cellClassName: "bg-green-100 font-bold" },
  ];

  const boards = (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <SlideTable title="Store Movers and Shakers" columns={storeCols} rows={storeRows} getKey={(r, i) => `${r.store_number}-${i}`} />
      </div>
      <div>
        <SlideTable title="DO Movers & Shakers" columns={doCols} rows={doRows} getKey={(r, i) => `${r.store_number}-${i}`} />
      </div>
    </div>
  );

  const isLoading = storeQ.isLoading || doQ.isLoading;
  const isError = storeQ.isError && doQ.isError;
  const empty = !storeRows.length && !doRows.length;

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
              Biggest climbers in rank{cur ? ` · ${pLabel}${prev ? ` vs P${prev.period}` : ""}` : ""}
              {official && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-white/30">Official sheet</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<string>
            dense value={String(limit)} onChange={(v) => setLimit(Number(v))}
            options={[{ value: "11", label: "Top 11" }, { value: "25", label: "25" }, { value: "50", label: "All" }]}
          />
          <button
            onClick={() => setPresent(true)}
            disabled={empty}
            className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/25 disabled:opacity-40"
          >
            <Presentation className="h-4 w-4" />Present
          </button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : isError ? (
        <EmptyState title="Couldn't load" description={(storeQ.error as Error)?.message ?? "Try again."} />
      ) : empty ? (
        <EmptyState title="No period-over-period movement yet" description="Needs two periods to compare — the newest period (uploaded sheet or live run) and the one before it. Upload the prior period's SOAR PTD RANKING, or run the ranker for both periods." />
      ) : (
        boards
      )}

      <PresentModal open={present} onClose={() => setPresent(false)} filename={`${pLabel || "SOAR"}-movers-shakers`}>
        <div className="mb-4 text-center text-2xl font-black tracking-tight text-black">
          {pLabel ? `${pLabel} ` : ""}Movers &amp; Shakers
        </div>
        {boards}
      </PresentModal>
    </div>
  );
}
