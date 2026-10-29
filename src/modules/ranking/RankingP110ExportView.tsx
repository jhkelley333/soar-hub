// Full metrics export — select period range, preview in a scrollable table,
// and download an Excel workbook with one sheet per week.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchFullMetricsExport, type FullMetricsExportRow } from "./api";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Button } from "@/shared/ui/Button";
import { Download } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function n2(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}
function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}
function dollar(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${Math.round(v).toLocaleString()}`;
}

// Sheet name: "P7 W1" — matches the Ranker week-picker format.
// Avoid ? which is illegal in Excel sheet names; fall back to 0.
function weekLabel(row: FullMetricsExportRow): string {
  return `P${row.period} W${row.week ?? 0}`;
}

// ── Excel column definitions ──────────────────────────────────────────────────

const XL_COLS: { header: string; key: keyof FullMetricsExportRow }[] = [
  { header: "Period",           key: "period" },
  { header: "Week",             key: "week" },
  { header: "Week Ending",      key: "week_ending" },
  { header: "Source",           key: "source" },
  { header: "Rank",             key: "rank" },
  { header: "Total Points",     key: "total_points" },
  { header: "Store #",          key: "store" },
  { header: "Location",         key: "location" },
  { header: "GM",               key: "gm" },
  { header: "DO",               key: "do_name" },
  { header: "SDO",              key: "sdo_name" },
  { header: "PTD Sales",        key: "ptd_sales" },
  { header: "LY Sales",         key: "ly_sales" },
  { header: "% vs LY",          key: "pct_vs_ly" },
  { header: "Tickets",          key: "tickets" },
  { header: "Tickets vs LY %",  key: "tickets_vs_ly_pct" },
  { header: "Sales Score",      key: "sales_score" },
  { header: "COGS Eff",         key: "cogs_eff" },
  { header: "FC Miss",          key: "fc_miss" },
  { header: "FC Annualized",    key: "fc_annualized" },
  { header: "FC Score",         key: "fc_score" },
  { header: "Labor %",          key: "labor_pct" },
  { header: "Labor Chart",      key: "labor_chart" },
  { header: "Labor Variance",   key: "labor_variance" },
  { header: "Labor Miss",       key: "labor_miss" },
  { header: "Labor Score",      key: "labor_score" },
  { header: "On-Time %",        key: "on_time_pct" },
  { header: "On-Time Score",    key: "on_time_score" },
  { header: "Calls/10K",        key: "calls_per_10k" },
  { header: "Complaints Score", key: "complaints_score" },
  { header: "VOG Raw",          key: "vog_raw" },
  { header: "VOG Score",        key: "vog_score" },
  { header: "EcoSure Score",    key: "ecosure_score" },
  { header: "BSC Score",        key: "bsc_score" },
  { header: "Training %",       key: "total_training_pct" },
  { header: "Training Score",   key: "total_training_score" },
  { header: "Fin Score",        key: "fin_score" },
  { header: "Ops Score",        key: "ops_score" },
  { header: "Voids",            key: "voids" },
  { header: "Voids %",          key: "voids_pct" },
  { header: "Cash Over/Short",  key: "cash_over_short" },
  { header: "DOH",              key: "doh" },
  { header: "MS Count",         key: "ms_count" },
  { header: "MS Score",         key: "ms_score" },
  { header: "TR vs TZ",         key: "tr_vs_tz" },
  { header: "Evening %",        key: "evening_pct" },
];

// ── Excel download ────────────────────────────────────────────────────────────

async function downloadExcel(
  rows: FullMetricsExportRow[],
  fromP: number,
  toP: number,
  onError: (msg: string) => void,
) {
  try {
    // Dynamic import so bundlers don't tree-shake critical xlsx internals.
    const XLSX = await import("xlsx");

    // Group rows by week label ("P7 W1", "P7 W2" …).
    type Sheet = { period: number; week: number | null; rows: FullMetricsExportRow[] };
    const sheetMap = new Map<string, Sheet>();
    for (const row of rows) {
      const key = weekLabel(row);
      if (!sheetMap.has(key)) sheetMap.set(key, { period: row.period, week: row.week, rows: [] });
      sheetMap.get(key)!.rows.push(row);
    }

    // Sort sheets by period then week.
    const sorted = [...sheetMap.entries()].sort(([, a], [, b]) =>
      a.period !== b.period ? a.period - b.period : (a.week ?? 0) - (b.week ?? 0)
    );

    const wb = XLSX.utils.book_new();
    for (const [name, sheet] of sorted) {
      const aoa: unknown[][] = [XL_COLS.map((c) => c.header)];
      for (const row of sheet.rows) {
        aoa.push(XL_COLS.map((c) => row[c.key] ?? null));
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = XL_COLS.map((c) => ({ wch: Math.max(c.header.length, 10) }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    }

    // Write to Uint8Array, then trigger download via hidden anchor.
    // Cast through unknown to satisfy strict BlobPart typing.
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as unknown as BlobPart;
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soar-ranking-P${fromP}-P${toP}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    onError((e as Error).message ?? "Excel download failed");
  }
}

// ── Period selector ───────────────────────────────────────────────────────────

function PeriodSelect({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-border bg-background px-2 py-1 text-sm"
      >
        {PERIODS.filter((p) => (min == null || p >= min) && (max == null || p <= max)).map((p) => (
          <option key={p} value={p}>P{p}</option>
        ))}
      </select>
    </label>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function RankingP110ExportView() {
  const [fromP, setFromP] = useState(1);
  const [toP, setToP] = useState(13);
  const [dlError, setDlError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["full-metrics-export", fromP, toP],
    queryFn: () => fetchFullMetricsExport(fromP, toP),
    staleTime: 5 * 60 * 1000,
  });

  const rows = data?.rows ?? [];
  const weekCount = new Set(rows.map(weekLabel)).size;

  async function handleDownload() {
    setDlError(null);
    setDownloading(true);
    await downloadExcel(rows, fromP, toP, setDlError);
    setDownloading(false);
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <PeriodSelect
          label="From"
          value={fromP}
          onChange={(v) => { setFromP(v); if (v > toP) setToP(v); }}
          max={toP}
        />
        <PeriodSelect
          label="To"
          value={toP}
          onChange={(v) => { setToP(v); if (v < fromP) setFromP(v); }}
          min={fromP}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={isLoading || rows.length === 0 || downloading}
          onClick={handleDownload}
          className="ml-auto"
        >
          <Download className="mr-1.5 h-4 w-4" />
          {downloading
            ? "Building…"
            : `Download Excel${weekCount > 0 ? ` (${weekCount} sheet${weekCount !== 1 ? "s" : ""})` : ""}`}
        </Button>
      </div>

      {/* Errors */}
      {(error || dlError) && (
        <p className="text-sm text-destructive">
          {dlError ?? (error as Error).message}
        </p>
      )}

      {/* Table preview */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No run data for P{fromP}–P{toP}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="whitespace-nowrap px-2 py-2 text-left font-medium">Week</th>
                <th className="whitespace-nowrap px-2 py-2 text-left font-medium">Store</th>
                <th className="whitespace-nowrap px-2 py-2 text-left font-medium">Location</th>
                <th className="whitespace-nowrap px-2 py-2 text-left font-medium">GM</th>
                <th className="whitespace-nowrap px-2 py-2 text-left font-medium">DO</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">Rank</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">Points</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">PTD Sales</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">% vs LY</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">Sales Sc</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">FC Sc</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">Labor %</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">Labor Sc</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">On-Time%</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">OT Sc</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">VOG</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">Fin Sc</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-medium">Ops Sc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-2 py-1.5 font-medium">{weekLabel(row)}</td>
                  <td className="px-2 py-1.5 font-mono">{row.store}</td>
                  <td className="max-w-[160px] truncate px-2 py-1.5">{row.location ?? "—"}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5">{row.gm ?? "—"}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5">{row.do_name ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right">{row.rank ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right">{n2(row.total_points, 2)}</td>
                  <td className="px-2 py-1.5 text-right">{dollar(row.ptd_sales)}</td>
                  <td className="px-2 py-1.5 text-right">{pct(row.pct_vs_ly)}</td>
                  <td className="px-2 py-1.5 text-right">{n2(row.sales_score, 2)}</td>
                  <td className="px-2 py-1.5 text-right">{n2(row.fc_score, 2)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {row.labor_pct != null ? `${(row.labor_pct * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">{n2(row.labor_score, 2)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {row.on_time_pct != null ? `${(row.on_time_pct * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">{n2(row.on_time_score, 2)}</td>
                  <td className="px-2 py-1.5 text-right">{n2(row.vog_raw, 2)}</td>
                  <td className="px-2 py-1.5 text-right">{n2(row.fin_score, 2)}</td>
                  <td className="px-2 py-1.5 text-right">{n2(row.ops_score, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        One Excel sheet per week (P7 W1, P7 W2 …) · {XL_COLS.length} metric columns per sheet.
      </p>
    </div>
  );
}
