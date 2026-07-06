// P&L module — shared types (mirror netlify/functions/pl.js shapes).

export interface PlLine {
  label: string;
  amount: number | null;
  /** Percent of sales, already scaled (66.99 = 66.99%). */
  pct: number | null;
  /** Subtotal/summary row — rendered bold with a rule. */
  total?: boolean;
}

export interface PlPeriod {
  period_end: string; // YYYY-MM-DD
  period_label: string | null;
  is_final: boolean;
}

export interface PlOverviewRow {
  store_number: string;
  store_name: string | null;
  period_label: string | null;
  is_final: boolean;
  total_sales: number | null;
  gross_profit: number | null;
  ci_amount: number | null;
  ci_pct: number | null;
  ebitda: number | null;
}

export interface PlStatement extends PlOverviewRow {
  period_end: string;
  lines: PlLine[];
  uploaded_by_name: string | null;
  updated_at: string;
}

// Client-side workbook parse result (see parseWorkbook.ts).
export interface ParsedPlStore {
  store_number: string;
  store_name: string;
  lines: PlLine[];
  total_sales: number | null;
  gross_profit: number | null;
  ci_amount: number | null;
  ci_pct: number | null;
  ebitda: number | null;
}

export interface ParsedWorkbook {
  period_end: string;
  suggested_label: string;
  stores: ParsedPlStore[];
  skipped_columns: string[]; // TOTAL/rollup columns we ignored
}
