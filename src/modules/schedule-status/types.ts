export interface SchedStatusRow {
  store_number: string;
  week_start: string;
  status: number | null;
  status_step: number | null;
  status_label: string | null;
  forecast: number | null;
  adjusted_forecast: number | null;
  projected_splh: number | null;
  scheduled_labor_pct: number | null;
  target_labor_pct: number | null;
  budget_usage: number | null;
  rvp: string | null;
  sdo: string | null;
  do_name: string | null;
  pulled_at: string;
  // org-decorated
  store_name: string | null;
  district: string | null;
  do_name_org: string | null;
  area: string | null;
  region: string | null;
}

export type StepCounts = { 1: number; 2: number; 3: number; 4: number; 5: number; unknown: number };

export interface SchedSummaryResp {
  ok: boolean;
  week: string;
  rows: SchedStatusRow[];
  stepCounts: StepCounts;
  total: number;
}

export interface SchedWeeksResp {
  ok: boolean;
  weeks: string[];
}

export interface SchedHistoryDay {
  checked_date: string;
  stepCounts: StepCounts;
  total: number;
}

export interface SchedHistoryResp {
  ok: boolean;
  week: string;
  days: SchedHistoryDay[];
}

// Step 4 = Approved, Step 5 = Published. Steps 1–3 are "not done".
export const STEP_LABELS: Record<number, string> = {
  1: "No Shift Started",
  2: "Draft",
  3: "Submitted",
  4: "Approved",
  5: "Published",
};
