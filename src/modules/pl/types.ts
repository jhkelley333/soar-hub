// P&L module — shared types (mirror netlify/functions/pl.js shapes).

export interface PlLine {
  label: string;
  amount: number | null;
  /** Percent of sales, already scaled (66.99 = 66.99%). */
  pct: number | null;
  /** Subtotal/summary row — rendered bold with a rule. */
  total?: boolean;
}

export type PlStage = "prelim" | "final";

export interface PlPeriod {
  period_end: string; // YYYY-MM-DD
  period_label: string | null;
  is_final: boolean; // true once a Final exists for the period
  has_prelim?: boolean;
  has_final?: boolean;
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
  stage?: PlStage;
  compare_available?: boolean;
}

export interface PlStatement extends PlOverviewRow {
  period_end: string;
  lines: PlLine[];
  uploaded_by_name: string | null;
  updated_at: string;
}

// ── Prelim vs Final comparison ──────────────────────────────────────
export interface PlCompareLine {
  label: string;
  total: boolean;
  prelim_amount: number | null;
  final_amount: number | null;
  delta: number | null;
  prelim_pct: number | null;
  final_pct: number | null;
  changed: boolean;
}

export interface PlHeadlineDelta {
  prelim: number | null;
  final: number | null;
  delta: number | null;
}

export interface PlCompare {
  store_number: string;
  store_name: string | null;
  period_end: string;
  period_label: string | null;
  headline: Record<"total_sales" | "gross_profit" | "ci_amount" | "ci_pct" | "ebitda", PlHeadlineDelta>;
  lines: PlCompareLine[];
  changed_count: number;
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
