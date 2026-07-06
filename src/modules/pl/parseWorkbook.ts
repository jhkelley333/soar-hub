// Client-side parser for the accounting side-by-side P&L workbook.
// Verified against SOAR_All_PL_Prelim_Jun_2026 (Heath region): row layout is
//   "Period Ending Sunday, June 28, 2026" in the top rows (col A),
//   store NAMES row, store NUMBERS row directly under it, a "Description"
//   header row, then ~85 line-item rows. Each store occupies a ($, %)
//   column pair; district/region TOTAL columns have a name but no numeric
//   store number and are skipped (the app rolls up from its own org data).
//
// SheetJS is imported dynamically by the caller so its weight only loads
// on the admin upload path.

import type { ParsedPlStore, ParsedWorkbook, PlLine } from "./types";

// Rows rendered bold-with-rule in the statement view.
const TOTAL_LABELS = new Set([
  "TOTAL SALES",
  "TOTAL COST OF SALES",
  "GROSS PROFIT",
  "TOTAL PAYROLL EXPENSE",
  "TOTAL UTILITY EXPENSE",
  "TOTAL REPAIR & MAINTENANCE",
  "CONTROLLABLE EXPENSES",
  "CONTROLLABLE INCOME",
  "NON - CONTROLLABLE EXPENSES",
  "OCCUPANCY EXPENSES",
  "TOTAL OPERATING EXPENSES",
  "EBITDA POST G&A",
]);

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Unrounded read — percent cells hold fractions (0.6698…) that must be
// scaled BEFORE rounding, or 66.99% collapses to 67%.
function rawNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isDigits(v: unknown): boolean {
  return /^\d{3,6}$/.test(String(v ?? "").trim());
}

export async function parsePlWorkbook(buf: ArrayBuffer): Promise<ParsedWorkbook> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Workbook has no sheets.");
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  // Header row = the one whose col A reads "Description".
  const descIdx = rows.findIndex((r) => String(r?.[0] ?? "").trim().toLowerCase() === "description");
  if (descIdx < 0) throw new Error('Couldn\'t find the "Description" header row — is this the P&L side-by-side file?');

  // Store-numbers row = the row above the header with the most DI-looking
  // cells; names sit directly above it.
  let numbersIdx = -1;
  let best = 0;
  for (let r = 0; r < descIdx; r++) {
    const count = (rows[r] ?? []).filter(isDigits).length;
    if (count > best) {
      best = count;
      numbersIdx = r;
    }
  }
  if (numbersIdx < 1 || best < 3) throw new Error("Couldn't find the store-number header row.");
  const namesRow = rows[numbersIdx - 1] ?? [];
  const numbersRow = rows[numbersIdx] ?? [];

  // Period end — "Period Ending Sunday, June 28, 2026".
  let periodEnd: string | null = null;
  for (let r = 0; r < descIdx; r++) {
    const m = /period ending\s+(?:\w+,\s*)?(.+)$/i.exec(String(rows[r]?.[0] ?? "").trim());
    if (m) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) {
        periodEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      break;
    }
  }
  if (!periodEnd) throw new Error('Couldn\'t parse the "Period Ending" date from the top of the sheet.');
  const suggested_label = new Date(`${periodEnd}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  // Column groups: each store is a ($ col, % col) pair. Rollup TOTAL
  // columns (name but no numeric DI) are skipped and reported.
  const groups: { number: string; name: string; col: number; pctCol: number }[] = [];
  const skipped: string[] = [];
  const width = Math.max(namesRow.length, numbersRow.length);
  for (let c = 1; c < width; c++) {
    const name = String(namesRow[c] ?? "").trim();
    const rawNum = numbersRow[c];
    if (isDigits(rawNum)) {
      groups.push({ number: String(rawNum).trim(), name, col: c, pctCol: c + 1 });
      c += 1; // consume the paired % column
    } else if (name) {
      skipped.push(name);
      c += 1;
    }
  }
  if (!groups.length) throw new Error("No store columns found.");
  // Dedupe skipped rollups while preserving order.
  const skipped_columns = Array.from(new Set(skipped));

  const stores: ParsedPlStore[] = groups.map((g) => {
    const lines: PlLine[] = [];
    let total_sales: number | null = null;
    let gross_profit: number | null = null;
    let ci_amount: number | null = null;
    let ci_pct: number | null = null;
    let ebitda: number | null = null;

    for (let r = descIdx + 1; r < rows.length; r++) {
      const label = String(rows[r]?.[0] ?? "").trim();
      if (!label) continue;
      const amount = num(rows[r]?.[g.col]);
      // Sheet stores percents as fractions (0.6698… = 66.99%) — scale
      // before rounding.
      const rawPct = rawNum(rows[r]?.[g.pctCol]);
      const pct = rawPct != null ? Math.round(rawPct * 10000) / 100 : null;
      const total = TOTAL_LABELS.has(label.toUpperCase());
      lines.push({ label, amount, pct, ...(total ? { total: true } : {}) });

      const u = label.toUpperCase();
      if (u === "TOTAL SALES") total_sales = amount;
      else if (u === "GROSS PROFIT") gross_profit = amount;
      else if (u === "CONTROLLABLE INCOME") {
        ci_amount = amount;
        ci_pct = pct;
      } else if (u === "EBITDA POST G&A") ebitda = amount;
    }

    return { store_number: g.number, store_name: g.name, lines, total_sales, gross_profit, ci_amount, ci_pct, ebitda };
  });

  return { period_end: periodEnd, suggested_label, stores, skipped_columns };
}
