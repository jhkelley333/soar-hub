// "Top Performers" — the recognition leaderboard for the newest period: Top
// Store Performers + Top DO Leaders, by SOAR rank. Mirrors the printed slide,
// and a Present button opens a full-screen, screenshot / PNG-ready version.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Presentation } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { fetchTopPerformers, type TopStoreRow, type TopDoRow } from "./api";
import { SlideTable, PresentModal, type SlideCol } from "./present";

const pts = (v: number | null) => (v == null ? "—" : String(Math.round(v)));

const storeCols: SlideCol<TopStoreRow>[] = [
  { key: "rank", label: "SOAR Rank", align: "center", cell: (r) => r.rank ?? "—", cellClassName: "font-bold" },
  { key: "store", label: "Store #", align: "center", cell: (r) => r.store_number, cellClassName: "bg-blue-100 font-semibold" },
  { key: "loc", label: "Location", cell: (r) => r.location ?? "—" },
  { key: "gm", label: "GM", cell: (r) => r.gm ?? "—" },
  { key: "do", label: "DO", cell: (r) => r.do_name ?? "—" },
  { key: "sdo", label: "SDO", cell: (r) => r.sdo_name ?? "—" },
  { key: "pts", label: "Total Points", align: "center", cell: (r) => pts(r.total_points), cellClassName: "bg-green-100 font-bold" },
];
const doCols: SlideCol<TopDoRow>[] = [
  { key: "rank", label: "SOAR Rank", align: "center", cell: (r) => r.rank ?? "—", cellClassName: "font-bold" },
  { key: "do", label: "DO", cell: (r) => r.name ?? "—", cellClassName: "font-semibold" },
  { key: "sdo", label: "SDO", cell: (r) => r.sdo_name ?? "—" },
  { key: "pts", label: "Total Points", align: "center", cell: (r) => pts(r.total_points), cellClassName: "bg-green-100 font-bold" },
];

export function RankingTopPerformersView() {
  const [storeN, setStoreN] = useState(15);
  const [present, setPresent] = useState(false);
  const q = useQuery({
    queryKey: ["ranking-top", storeN],
    queryFn: () => fetchTopPerformers(storeN, 10),
    staleTime: 5 * 60_000,
  });
  const stores: TopStoreRow[] = q.data?.stores ?? [];
  const dos: TopDoRow[] = q.data?.dos ?? [];
  const period = q.data?.period ?? null;
  const official = q.data?.source === "official";
  const pLabel = period ? `P${period}` : "";

  const boards = (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <SlideTable title="Top Store Performers" columns={storeCols} rows={stores} getKey={(r) => r.store_number} />
      </div>
      <div>
        <SlideTable title="Top DO Leaders" columns={doCols} rows={dos} getKey={(r, i) => `${r.name}-${i}`} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
            <Trophy className="h-6 w-6" />
          </span>
          <div>
            <div className="text-xl font-black tracking-tight">Top Performers</div>
            <div className="text-xs font-medium text-white/80">
              Highest SOAR rank{period ? ` · ${pLabel}` : ""}
              {official && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-white/30">Official sheet</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<string>
            dense value={String(storeN)} onChange={(v) => setStoreN(Number(v))}
            options={[{ value: "10", label: "Top 10" }, { value: "15", label: "15" }, { value: "25", label: "25" }]}
          />
          <button
            onClick={() => setPresent(true)}
            disabled={!stores.length && !dos.length}
            className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/25 disabled:opacity-40"
          >
            <Presentation className="h-4 w-4" />Present
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
      ) : !stores.length && !dos.length ? (
        <EmptyState title="No ranking data yet" description="Upload a SOAR PTD RANKING sheet or run the ranker, then the top performers show here." />
      ) : (
        boards
      )}

      <PresentModal open={present} onClose={() => setPresent(false)} filename={`${pLabel || "SOAR"}-top-performers`}>
        <div className="mb-4 text-center text-2xl font-black tracking-tight text-black">
          Top Performers{pLabel ? ` · ${pLabel}` : ""}
        </div>
        {boards}
      </PresentModal>
    </div>
  );
}
