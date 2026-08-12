// Bottom Performers by SDO — the bottom-N GMs and the bottom DO in each SDO,
// ranked by average weekly ranker standing across this fiscal year, with each
// entity's year trend. Reads ranking-admin's bottom-performers action.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp, Minus, Download, ArrowDownWideNarrow } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchBottomPerformers, type BottomPerformers, type BottomTrend, type BottomGM, type BottomDO } from "./api";

function TrendChip({ t }: { t: BottomTrend }) {
  const Icon = t.dir === "improving" ? TrendingUp : t.dir === "declining" ? TrendingDown : Minus;
  const cls = t.dir === "improving" ? "text-emerald-600" : t.dir === "declining" ? "text-red-600" : "text-zinc-400";
  const label = t.dir === "improving" ? `Improving (${t.delta > 0 ? "-" : ""}${Math.abs(t.delta)} rank)` : t.dir === "declining" ? `Declining (+${Math.abs(t.delta)} rank)` : "Flat";
  return <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", cls)} title="Avg rank, first half vs recent half of the year"><Icon className="h-3.5 w-3.5" />{label}</span>;
}

async function exportXlsx(data: BottomPerformers) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); wb.creator = "SOAR Hub";
  const ws = wb.addWorksheet("Bottom Performers", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(["SDO", "Type", "Name / GM", "Store #", "Avg Rank", "Avg Points", "Best", "Worst", "Weeks", "Trend"]);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  for (const g of data.sdos) {
    g.bottom_gms.forEach((s, i) => ws.addRow([g.sdo, `Bottom GM #${i + 1}`, s.gm ?? s.location ?? "", s.store_number, s.avg_rank, s.avg_points, s.best_rank, s.worst_rank, s.weeks, s.trend.dir]));
    if (g.bottom_do) { const d = g.bottom_do; ws.addRow([g.sdo, "Bottom DO", d.name, "", d.avg_rank, d.avg_points, d.best_rank, d.worst_rank, d.weeks, d.trend.dir]); }
  }
  ws.columns.forEach((c: { width?: number }, i: number) => { c.width = i === 0 ? 22 : i === 2 ? 24 : 11; });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `Bottom Performers by SDO - ${new Date().toLocaleDateString("en-CA")}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

export function BottomPerformersPage() {
  const toast = useToast();
  const [gmPerSdo, setGmPerSdo] = useState(2);
  const q = useQuery({ queryKey: ["ranking-bottom", gmPerSdo], queryFn: () => fetchBottomPerformers(gmPerSdo) });
  const data = q.data;

  return (
    <>
      <PageHeader
        title="Bottom Performers by SDO"
        description={data ? `Lowest ${data.gm_per_sdo} GM(s) and bottom DO per SDO · avg weekly rank across ${data.weeks} week(s) this fiscal year` : "Year-to-date ranker standings, worst performers per SDO."}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-zinc-600">
              <ArrowDownWideNarrow className="h-4 w-4 text-zinc-400" /> GMs per SDO
              <select value={gmPerSdo} onChange={(e) => setGmPerSdo(Number(e.target.value))} className="rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <Button variant="secondary" size="sm" disabled={!data?.sdos.length} onClick={() => data && exportXlsx(data).catch((e) => toast.push(e instanceof Error ? e.message : "Export failed", "error"))}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Excel
            </Button>
          </div>
        }
      />

      {q.isLoading && <Skeleton className="h-96 w-full" />}
      {q.isError && <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />}
      {data && data.sdos.length === 0 && <EmptyState title="No ranker data this year" description="No completed ranking runs found for the current fiscal year." />}

      {data && data.sdos.length > 0 && (
        <div className="space-y-4">
          {data.sdos.map((g) => (
            <Card key={g.sdo} className="overflow-hidden p-5">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-bold tracking-tight text-midnight">{g.sdo}</h2>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{g.store_count} store(s) · {g.do_count} DO(s)</span>
              </div>

              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Bottom {g.bottom_gms.length} GM(s)</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-[10px] uppercase tracking-wide text-zinc-400">
                    <tr><th className="py-1.5">Store</th><th className="py-1.5">GM</th><th className="py-1.5 text-right">Avg rank</th><th className="py-1.5 text-right">Best–Worst</th><th className="py-1.5 text-right">Weeks</th><th className="py-1.5 text-right">Trend</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {g.bottom_gms.map((s) => <GmRow key={s.store_number} s={s} />)}
                  </tbody>
                </table>
              </div>

              {g.bottom_do && (
                <div className="mt-4 rounded-lg bg-zinc-50 p-3 ring-1 ring-inset ring-zinc-200">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Bottom DO</div>
                  <DoRow d={g.bottom_do} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function GmRow({ s }: { s: BottomGM }) {
  return (
    <tr>
      <td className="py-2">
        <span className="font-mono text-xs font-semibold text-midnight">#{s.store_number}</span>
        {s.location && <span className="ml-1.5 text-zinc-500">{s.location}</span>}
      </td>
      <td className="py-2 text-zinc-700">{s.gm ?? "—"}</td>
      <td className="py-2 text-right font-semibold tabular-nums text-midnight">{s.avg_rank ?? "—"}</td>
      <td className="py-2 text-right tabular-nums text-zinc-500">{s.best_rank}–{s.worst_rank}</td>
      <td className="py-2 text-right tabular-nums text-zinc-500">{s.weeks}</td>
      <td className="py-2 text-right"><TrendChip t={s.trend} /></td>
    </tr>
  );
}

function DoRow({ d }: { d: BottomDO }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-sm font-semibold text-midnight">{d.name}</div>
      <div className="flex items-center gap-4 text-sm">
        <span className="tabular-nums text-zinc-600">Avg rank <b className="text-midnight">{d.avg_rank ?? "—"}</b></span>
        <span className="tabular-nums text-zinc-400">{d.best_rank}–{d.worst_rank} · {d.weeks}wk</span>
        <TrendChip t={d.trend} />
      </div>
    </div>
  );
}
