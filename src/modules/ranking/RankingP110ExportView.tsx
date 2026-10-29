// Period-range pivot export — choose any from/to period, see all stores and
// DOs with per-period metrics, and copy or download the result.

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchP110Export, type P110StoreRow, type P110LeaderRow } from "./api";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Button } from "@/shared/ui/Button";
import { Copy, Check, Download } from "lucide-react";
import { cn } from "@/lib/cn";

const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const fmtSales = (v: number | null | undefined) =>
  v == null ? "—" : `$${Math.round(v).toLocaleString()}`;
const fmtRank = (v: number | null | undefined) => (v == null ? "—" : String(v));
const trend = (delta: number | null | undefined) => {
  if (delta == null) return "";
  if (delta > 0) return `↑${delta}`;
  if (delta < 0) return `↓${Math.abs(delta)}`;
  return "—";
};

// ── Copy-for-Cowork formatter ────────────────────────────────────────────────

function buildCoworkText(
  periods: number[],
  stores: P110StoreRow[],
  leaders: P110LeaderRow[],
  company: ReturnType<typeof fetchP110Export> extends Promise<infer R> ? (R extends { company: infer C } ? C : never) : never,
): string {
  const ps = periods.map((p) => `P${p}`).join(", ");
  const line = "═".repeat(60);
  const sep = "─".repeat(60);
  const rows: string[] = [];

  rows.push(`SOAR QSR Year-in-Review: Official Ranking Data`);
  rows.push(`Periods covered: ${ps}`);
  rows.push(`Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`);
  rows.push("");

  rows.push(line);
  rows.push("STORE RANKINGS BY PERIOD");
  rows.push(line);
  const storeHdr = ["Store", "Location", "GM", ...periods.map((p) => `P${p}`), "YTD Avg", "Best", "Trend"].join("\t");
  rows.push(storeHdr);
  rows.push(sep);
  for (const s of stores) {
    const periodRanks = periods.map((p) => fmtRank(s.by_period[p]?.rank));
    rows.push([
      s.store_number,
      s.location ?? "—",
      s.gm ?? "—",
      ...periodRanks,
      fmtRank(s.ytd.avg_rank),
      fmtRank(s.ytd.best_rank),
      trend(s.ytd.rank_delta),
    ].join("\t"));
  }
  rows.push("");

  rows.push(line);
  rows.push("STORE SALES VS PRIOR YEAR (% YoY) BY PERIOD");
  rows.push(line);
  const pctHdr = ["Store", "Location", ...periods.map((p) => `P${p}`), "YTD Avg"].join("\t");
  rows.push(pctHdr);
  rows.push(sep);
  for (const s of stores) {
    const periodPcts = periods.map((p) => fmtPct(s.by_period[p]?.pct_vs_ly));
    rows.push([
      s.store_number,
      s.location ?? "—",
      ...periodPcts,
      fmtPct(s.ytd.avg_pct_vs_ly),
    ].join("\t"));
  }
  rows.push("");

  rows.push(line);
  rows.push("STORE PTD SALES BY PERIOD");
  rows.push(line);
  const salesHdr = ["Store", "Location", ...periods.map((p) => `P${p}`), "YTD Total"].join("\t");
  rows.push(salesHdr);
  rows.push(sep);
  for (const s of stores) {
    const periodSales = periods.map((p) => fmtSales(s.by_period[p]?.ptd_sales));
    rows.push([
      s.store_number,
      s.location ?? "—",
      ...periodSales,
      fmtSales(s.ytd.total_sales),
    ].join("\t"));
  }
  rows.push("");

  rows.push(line);
  rows.push("DO RANKINGS BY PERIOD");
  rows.push(line);
  const doHdr = ["DO", "SDO", ...periods.map((p) => `P${p}`), "YTD Avg", "Best", "Trend"].join("\t");
  rows.push(doHdr);
  rows.push(sep);
  for (const l of leaders) {
    const periodRanks = periods.map((p) => fmtRank(l.by_period[p]?.rank));
    rows.push([
      l.name,
      l.sdo_name ?? "—",
      ...periodRanks,
      fmtRank(l.ytd.avg_rank),
      fmtRank(l.ytd.best_rank),
      trend(l.ytd.rank_delta),
    ].join("\t"));
  }
  rows.push("");

  rows.push(line);
  rows.push(`COMPANY YTD AVERAGES (${ps})`);
  rows.push(line);
  if (company) {
    rows.push(`Stores ranked:     ${company.store_count}`);
    rows.push(`DOs ranked:        ${company.do_count}`);
    rows.push(`Avg store rank:    ${fmtRank(company.avg_rank)}`);
    rows.push(`Avg % vs LY:       ${fmtPct(company.avg_pct_vs_ly)}`);
    rows.push(`Total system sales: ${fmtSales(company.total_sales)}`);
    rows.push("");
    rows.push("Avg store rank by period:");
    for (const p of periods) {
      const r = company.avg_rank_by_period[p];
      const pc = company.avg_pct_by_period[p];
      rows.push(`  P${p}: rank ${fmtRank(r)}  |  % vs LY ${fmtPct(pc)}`);
    }
  }

  return rows.join("\n");
}

// ── CSV builder ──────────────────────────────────────────────────────────────

function buildCsv(periods: number[], stores: P110StoreRow[], leaders: P110LeaderRow[]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const storeHeader = ["Type", "Store/Name", "Location/SDO", "GM", ...periods.flatMap((p) => [`P${p} Rank`, `P${p} Points`, `P${p} Sales`, `P${p} LY Sales`, `P${p} % vs LY`]), "YTD Avg Rank", "YTD Best Rank", "YTD Rank Trend", "YTD Avg % vs LY", "YTD Total Sales"];
  const csvRows: string[] = [storeHeader.map(esc).join(",")];

  for (const s of stores) {
    const row = [
      "Store", s.store_number, s.location ?? "", s.gm ?? "",
      ...periods.flatMap((p) => {
        const sp = s.by_period[p];
        return [sp?.rank ?? "", sp?.total_points ?? "", sp?.ptd_sales ?? "", sp?.ly_sales ?? "", sp?.pct_vs_ly != null ? (sp.pct_vs_ly * 100).toFixed(2) : ""];
      }),
      s.ytd.avg_rank ?? "", s.ytd.best_rank ?? "", s.ytd.rank_delta ?? "", s.ytd.avg_pct_vs_ly != null ? (s.ytd.avg_pct_vs_ly * 100).toFixed(2) : "", s.ytd.total_sales ?? "",
    ];
    csvRows.push(row.map(esc).join(","));
  }

  csvRows.push("");
  const doHeader = ["Type", "Name", "SDO", "", ...periods.flatMap((p) => [`P${p} Rank`, `P${p} Points`, `P${p} Sales`, `P${p} LY Sales`, ``]), "YTD Avg Rank", "YTD Best Rank", "YTD Rank Trend", "", ""];
  csvRows.push(doHeader.map(esc).join(","));
  for (const l of leaders) {
    const row = [
      "DO", l.name, l.sdo_name ?? "", "",
      ...periods.flatMap((p) => {
        const lp = l.by_period[p];
        return [lp?.rank ?? "", lp?.total_points ?? "", lp?.ptd_sales ?? "", lp?.ly_sales ?? "", ""];
      }),
      l.ytd.avg_rank ?? "", l.ytd.best_rank ?? "", l.ytd.rank_delta ?? "", "", "",
    ];
    csvRows.push(row.map(esc).join(","));
  }

  return csvRows.join("\n");
}

// ── Sub-tables ───────────────────────────────────────────────────────────────

function StoreTable({ periods, stores }: { periods: number[]; stores: P110StoreRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="min-w-full text-xs">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            <th className="sticky left-0 z-10 bg-zinc-50 px-3 py-2 text-left font-semibold">Store</th>
            <th className="px-3 py-2 text-left font-semibold">Location</th>
            <th className="px-3 py-2 text-left font-semibold">GM</th>
            {periods.map((p) => (
              <th key={p} className="px-2 py-2 text-center font-semibold">P{p}</th>
            ))}
            <th className="px-2 py-2 text-center font-semibold text-zinc-700">Avg</th>
            <th className="px-2 py-2 text-center font-semibold text-zinc-700">Best</th>
            <th className="px-2 py-2 text-center font-semibold text-zinc-700">% vs LY</th>
            <th className="px-2 py-2 text-center font-semibold text-zinc-700">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {stores.map((s) => (
            <tr key={s.store_number} className="hover:bg-zinc-50">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-midnight">{s.store_number}</td>
              <td className="max-w-[160px] truncate px-3 py-1.5 text-zinc-600">{s.location ?? "—"}</td>
              <td className="max-w-[120px] truncate px-3 py-1.5 text-zinc-600">{s.gm ?? "—"}</td>
              {periods.map((p) => {
                const sp = s.by_period[p];
                const r = sp?.rank;
                return (
                  <td key={p} className={cn(
                    "px-2 py-1.5 text-center",
                    r === 1 ? "font-bold text-yellow-600" : r != null && r <= 5 ? "font-semibold text-green-700" : "text-zinc-700",
                  )}>
                    {fmtRank(r)}
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-center font-semibold text-zinc-800">{fmtRank(s.ytd.avg_rank)}</td>
              <td className="px-2 py-1.5 text-center text-green-700">{fmtRank(s.ytd.best_rank)}</td>
              <td className={cn(
                "px-2 py-1.5 text-center",
                s.ytd.avg_pct_vs_ly != null && s.ytd.avg_pct_vs_ly >= 0 ? "text-green-700" : "text-red-600",
              )}>
                {fmtPct(s.ytd.avg_pct_vs_ly)}
              </td>
              <td className={cn(
                "px-2 py-1.5 text-center",
                s.ytd.rank_delta != null && s.ytd.rank_delta > 0 ? "text-green-700" : s.ytd.rank_delta != null && s.ytd.rank_delta < 0 ? "text-red-600" : "text-zinc-400",
              )}>
                {trend(s.ytd.rank_delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DoTable({ periods, leaders }: { periods: number[]; leaders: P110LeaderRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="min-w-full text-xs">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            <th className="sticky left-0 z-10 bg-zinc-50 px-3 py-2 text-left font-semibold">DO</th>
            <th className="px-3 py-2 text-left font-semibold">SDO</th>
            {periods.map((p) => (
              <th key={p} className="px-2 py-2 text-center font-semibold">P{p}</th>
            ))}
            <th className="px-2 py-2 text-center font-semibold text-zinc-700">Avg</th>
            <th className="px-2 py-2 text-center font-semibold text-zinc-700">Best</th>
            <th className="px-2 py-2 text-center font-semibold text-zinc-700">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {leaders.map((l) => (
            <tr key={l.name} className="hover:bg-zinc-50">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-midnight">{l.name}</td>
              <td className="max-w-[140px] truncate px-3 py-1.5 text-zinc-600">{l.sdo_name ?? "—"}</td>
              {periods.map((p) => {
                const lp = l.by_period[p];
                const r = lp?.rank;
                return (
                  <td key={p} className={cn(
                    "px-2 py-1.5 text-center",
                    r === 1 ? "font-bold text-yellow-600" : r != null && r <= 3 ? "font-semibold text-green-700" : "text-zinc-700",
                  )}>
                    {fmtRank(r)}
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-center font-semibold text-zinc-800">{fmtRank(l.ytd.avg_rank)}</td>
              <td className="px-2 py-1.5 text-center text-green-700">{fmtRank(l.ytd.best_rank)}</td>
              <td className={cn(
                "px-2 py-1.5 text-center",
                l.ytd.rank_delta != null && l.ytd.rank_delta > 0 ? "text-green-700" : l.ytd.rank_delta != null && l.ytd.rank_delta < 0 ? "text-red-600" : "text-zinc-400",
              )}>
                {trend(l.ytd.rank_delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

const PERIOD_OPTS = Array.from({ length: 13 }, (_, i) => i + 1);

function PeriodSelect({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-accent focus:outline-none"
      >
        {PERIOD_OPTS.filter((p) => p <= max).map((p) => (
          <option key={p} value={p}>P{p}</option>
        ))}
      </select>
    </label>
  );
}

export function RankingP110ExportView() {
  const [fromP, setFromP] = useState(1);
  const [toP, setToP] = useState(13);
  const q = useQuery({
    queryKey: ["p110-export", fromP, toP],
    queryFn: () => fetchP110Export(fromP, toP),
    staleTime: 5 * 60_000,
  });
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const data = q.data;
  const periods = data?.periods ?? [];
  const stores = data?.stores ?? [];
  const leaders = data?.leaders ?? [];
  const company = data?.company ?? null;

  function copyForCowork() {
    if (!data) return;
    const text = buildCoworkText(periods, stores, leaders, company);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function downloadCsv() {
    if (!data) return;
    const csv = buildCsv(periods, stores, leaders);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soar-ranking-p1-p${periods[periods.length - 1] ?? 10}-${new Date().toLocaleDateString("en-CA")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5">
            <PeriodSelect label="From" value={fromP} max={toP} onChange={setFromP} />
            <span className="text-xs text-zinc-400">→</span>
            <PeriodSelect label="To" value={toP} max={13} onChange={(v) => { setToP(v); if (v < fromP) setFromP(v); }} />
          </div>
        </div>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (q.error || data?.error) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        {data?.error ?? String(q.error)}
      </div>
    );
  }

  if (!periods.length && !q.isFetching) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 w-fit">
          <PeriodSelect label="From" value={fromP} max={toP} onChange={setFromP} />
          <span className="text-xs text-zinc-400">→</span>
          <PeriodSelect label="To" value={toP} max={13} onChange={(v) => { setToP(v); if (v < fromP) setFromP(v); }} />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-500">
          No official period data found for P{fromP}–P{toP}. Try a different range or upload the PTD ranking sheet.
        </div>
      </div>
    );
  }

  const ps = periods.map((p) => `P${p}`).join("–");

  return (
    <div className="space-y-6">
      {/* Header + period range + actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-midnight">{ps} Official Ranking Export</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {stores.length} stores · {leaders.length} DOs · {periods.length} periods loaded
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Period range selector */}
          <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5">
            <PeriodSelect label="From" value={fromP} max={toP} onChange={(v) => setFromP(v)} />
            <span className="text-xs text-zinc-400">→</span>
            <PeriodSelect label="To" value={toP} max={13} onChange={(v) => { setToP(v); if (v < fromP) setFromP(v); }} />
          </div>
          <Button variant="ghost" size="sm" onClick={downloadCsv} disabled={!data || q.isFetching} className="gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" />
            Download CSV
          </Button>
          <Button size="sm" onClick={copyForCowork} disabled={!data || q.isFetching} className="gap-1.5 text-xs">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied!" : "Copy for Cowork"}
          </Button>
        </div>
      </div>

      {/* Company summary bar */}
      {company && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Stores</p>
            <p className="text-lg font-bold text-midnight">{company.store_count}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">DOs</p>
            <p className="text-lg font-bold text-midnight">{company.do_count}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Avg Store Rank</p>
            <p className="text-lg font-bold text-midnight">{fmtRank(company.avg_rank)}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Avg % vs LY</p>
            <p className={cn("text-lg font-bold", company.avg_pct_vs_ly != null && company.avg_pct_vs_ly >= 0 ? "text-green-700" : "text-red-600")}>
              {fmtPct(company.avg_pct_vs_ly)}
            </p>
          </div>
        </div>
      )}

      {/* Per-period company averages */}
      {company && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Company averages by period</p>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <td className="pr-4 py-1 font-semibold">Metric</td>
                  {periods.map((p) => <td key={p} className="px-2 py-1 text-center font-semibold">P{p}</td>)}
                  <td className="px-2 py-1 text-center font-semibold text-zinc-700">YTD</td>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="pr-4 py-1 text-zinc-600">Avg rank</td>
                  {periods.map((p) => <td key={p} className="px-2 py-1 text-center text-zinc-800">{fmtRank(company.avg_rank_by_period[p])}</td>)}
                  <td className="px-2 py-1 text-center font-semibold text-zinc-800">{fmtRank(company.avg_rank)}</td>
                </tr>
                <tr>
                  <td className="pr-4 py-1 text-zinc-600">Avg % vs LY</td>
                  {periods.map((p) => {
                    const v = company.avg_pct_by_period[p];
                    return (
                      <td key={p} className={cn("px-2 py-1 text-center", v != null && v >= 0 ? "text-green-700" : "text-red-600")}>
                        {fmtPct(v)}
                      </td>
                    );
                  })}
                  <td className={cn("px-2 py-1 text-center font-semibold", company.avg_pct_vs_ly != null && company.avg_pct_vs_ly >= 0 ? "text-green-700" : "text-red-600")}>
                    {fmtPct(company.avg_pct_vs_ly)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Store rankings table */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Store rankings by period — sorted by YTD avg rank
        </p>
        <StoreTable periods={periods} stores={stores} />
      </div>

      {/* DO rankings table */}
      {leaders.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            DO rankings by period — sorted by YTD avg rank
          </p>
          <DoTable periods={periods} leaders={leaders} />
        </div>
      )}

      {/* Hidden textarea for legacy copy fallback */}
      <textarea ref={textRef} className="sr-only" readOnly aria-hidden />
    </div>
  );
}
