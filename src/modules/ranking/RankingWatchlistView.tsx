// Watchlist tab — the biggest Annualized Financial Miss, worst first, in the
// legacy ranker's FC-Miss-watchlist style. Reads the latest run's PTD store
// rows (annualized miss = labor + food cost, 52-week scaled); three headline
// tiles + a focused table. Admin-only, part of the ranking build.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Segmented } from "@/shared/ui/Segmented";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { toCSV, downloadCSV } from "@/lib/csv";
import { fetchRankingLatest, type RankingResultRow } from "./api";

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const fmtUSD = (v: unknown) => (isNum(v) ? `$${Math.round(v).toLocaleString("en-US")}` : "—");
const fmtPct1 = (v: unknown) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : "—");
const fmtSignedPct = (v: unknown) => (isNum(v) ? `${v > 0 ? "" : ""}${(v * 100).toFixed(2)}%` : typeof v === "string" ? v : "—");

// Which annualized miss to watch: total financial (labor + food cost),
// or either component alone.
type Metric = "finAnnualized" | "fcAnnualized" | "laborAnnualized";
const METRIC_LABEL: Record<Metric, string> = {
  finAnnualized: "Financial (labor + food)",
  fcAnnualized: "Food cost only",
  laborAnnualized: "Labor only",
};

export function RankingWatchlistView() {
  const toast = useToast();
  const [metric, setMetric] = useState<Metric>("finAnnualized");
  const q = useQuery({
    queryKey: ["ranking-run", "ptd", "store", "latest"],
    queryFn: () => fetchRankingLatest("ptd", "store"),
    staleTime: 60_000,
  });

  const run = q.data?.run ?? null;
  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    return all
      .filter((r) => isNum(r.metrics[metric]) && (r.metrics[metric] as number) > 0)
      .sort((a, b) => (b.metrics[metric] as number) - (a.metrics[metric] as number));
  }, [q.data, metric]);

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;
  if (!run) return <EmptyState title="No run yet" description="Run the ranking first — the watchlist reads the latest board." />;

  const total = rows.reduce((a, r) => a + (r.metrics[metric] as number), 0);
  const top = rows.length ? (rows[0].metrics[metric] as number) : 0;

  function exportCsv() {
    const headers = ["Store #", "Store", "GM", "Ann. Miss", "Sales", "% vs LY", "Labor %", "Rank"];
    const csvRows = rows.map((r) => ({
      "Store #": r.entity_key,
      "Store": String(r.metrics.location ?? ""),
      "GM": String(r.metrics.gm ?? ""),
      "Ann. Miss": Math.round(r.metrics[metric] as number),
      "Sales": isNum(r.metrics.sales) ? Math.round(r.metrics.sales as number) : "",
      "% vs LY": isNum(r.metrics.pctVsLy) ? Math.round((r.metrics.pctVsLy as number) * 10000) / 100 : "",
      "Labor %": isNum(r.metrics.laborPct) ? Math.round((r.metrics.laborPct as number) * 1000) / 10 : "",
      "Rank": r.rank ?? "",
    }));
    downloadCSV(`ann-miss-watchlist-P${run!.period}W${run!.week}.csv`, toCSV(headers, csvRows));
    toast.push(`Downloaded ${rows.length} stores.`, "success");
  }

  return (
    <div className="space-y-4">
      {/* Metric toggle + export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500">Annualized miss:</span>
          <Segmented<Metric>
            dense value={metric} onChange={setMetric}
            options={(Object.keys(METRIC_LABEL) as Metric[]).map((k) => ({ value: k, label: METRIC_LABEL[k] }))}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download className="mr-1 h-3.5 w-3.5" /> Excel
        </Button>
      </div>

      {/* Headline tiles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Stores on watchlist" value={String(rows.length)} />
        <Tile label="Total annualized miss" value={fmtUSD(total)} accent />
        <Tile label="Biggest single miss" value={fmtUSD(top)} accent />
      </div>

      {/* Watchlist table */}
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
        <div className="border-b border-zinc-100 px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
          Annualized {metric === "fcAnnualized" ? "Food Cost" : metric === "laborAnnualized" ? "Labor" : "Financial"} Miss Watchlist — P{run.period}W{run.week}
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No stores are missing on this measure — nothing to watch.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-zinc-50 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                  <Th>Store</Th><Th className="text-left">Name</Th><Th className="text-left">GM</Th>
                  <Th>Ann. Miss</Th><Th>Sales</Th><Th>% vs LY</Th><Th>Labor %</Th><Th>Rank</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <WatchRow key={r.entity_key} r={r} metric={metric} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-2xl font-black tabular-nums", accent ? "text-red-600" : "text-midnight")}>{value}</div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("whitespace-nowrap border-b border-zinc-200 px-3 py-2 text-right", className)}>{children}</th>;
}

function WatchRow({ r, metric }: { r: RankingResultRow; metric: Metric }) {
  const m = r.metrics;
  const vsly = m.pctVsLy;
  return (
    <tr className="border-b border-zinc-100 hover:bg-zinc-50">
      <td className="border-l-2 border-red-500 px-3 py-2 text-right font-mono text-sm font-bold text-accent">{r.entity_key}</td>
      <td className="px-3 py-2 text-left text-sm text-midnight">{String(m.location ?? "")}</td>
      <td className="px-3 py-2 text-left text-sm text-zinc-500">{String(m.gm ?? "—")}</td>
      <td className="px-3 py-2 text-right font-mono text-sm font-bold text-red-600">{fmtUSD(m[metric])}</td>
      <td className="px-3 py-2 text-right font-mono text-sm">{fmtUSD(m.sales)}</td>
      <td className={cn("px-3 py-2 text-right font-mono text-sm", isNum(vsly) ? ((vsly as number) >= 0 ? "text-emerald-700" : "text-red-600") : "text-zinc-400")}>
        {fmtSignedPct(vsly)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm">{fmtPct1(m.laborPct)}</td>
      <td className="px-3 py-2 text-right font-mono text-sm text-zinc-500">{r.rank ?? "—"}</td>
    </tr>
  );
}
