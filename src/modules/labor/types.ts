// Types for the Labor module — mirror the shapes returned by
// netlify/functions/labor.js.

export type ChartStatus = "on" | "over" | "unknown" | "missing";

export interface LaborStore {
  id: string;
  number: string;
  name: string;
  district_id: string;
}

// One band (Daily / WTD / PTD) of the GM day view.
export interface LaborBand {
  labor_pct: number | null;
  /** This band's OWN target % — daily, WTD and PTD each have their own. */
  goal_pct?: number | null;
  sales: number | null;
  variance_pts: number | null;
  dollars_over_chart: number | null;
  hours_over_chart: number | null;
  chart_dollars_allowed: number | null;
  avg_wage?: number | null;        // labor cost ÷ labor hours (Labor v2 only)
  training_credit?: number | null; // approved training $ credited out of this band (Labor v2)
  labor_pct_pre?: number | null;   // labor % before the training credit (Labor v2)
  status: ChartStatus;
}

export interface LaborReviewSummary {
  note: string;
  by: string | null;
  at: string | null;
}

// The anchor day card (extends a band with the note state).
export interface LaborDay extends LaborBand {
  business_date: string;
  note_due: boolean;
  explained: boolean;
  review: LaborReviewSummary | null;
}

export interface WeekStripDay {
  business_date: string;
  labor_pct: number | null;
  status: ChartStatus;
  note_due: boolean;
}

export interface GmLaborResponse {
  store: { number: string; name: string; district_id: string };
  date: string | null;
  goal: number | null;
  goal_source: string | null;
  gm_name: string | null;
  day: LaborDay | null;
  wtd: LaborBand | null;
  ptd: LaborBand | null;
  week: WeekStripDay[];
  notes_due: number;
}

export interface DistrictStoreRow {
  store_number: string;
  store_name: string | null;
  gm_name: string | null;
  do_name: string | null;
  labor_pct: number | null;
  variance_pts: number | null;
  dollars_over_chart: number | null;
  hours_over_chart: number | null;
  // Cumulative labor % through the anchor date, with per-band variance +
  // status so the Day/WTD/MTD view switch can re-key over-chart highlighting.
  wtd_labor_pct: number | null;
  ptd_labor_pct: number | null;
  wtd_dollars_over_chart: number | null;
  ptd_dollars_over_chart: number | null;
  wtd_hours_over_chart: number | null;
  ptd_hours_over_chart: number | null;
  wtd_variance_pts: number | null;
  ptd_variance_pts: number | null;
  wtd_status: ChartStatus;
  ptd_status: ChartStatus;
  status: ChartStatus;
  explained: boolean;
  note_due: boolean;
  note: string | null;
}

export interface DistrictRollup {
  store_count: number;
  district_labor_pct: number | null;
  wtd_labor_pct: number | null;
  ptd_labor_pct: number | null;
  stores_over_chart: number;
  dollars_over_chart: number;
  wtd_dollars_over_chart: number;
  ptd_dollars_over_chart: number;
  hours_over_chart: number;
  wtd_hours_over_chart: number;
  ptd_hours_over_chart: number;
  notes_due: number;
  notes_explained: number;
  dos: string[];
}

export interface DistrictLaborResponse {
  date: string | null;
  rollup: DistrictRollup | null;
  stores: DistrictStoreRow[];
}

export interface ReviewInput {
  store_number: string;
  business_date: string;
  note: string;
}

export interface LaborDistrict {
  id: string;
  name: string;
  code: string;
  store_count: number;
}

export interface SyncStateRow {
  business_date: string;
  content_hash: string;
  rows_captured: number;
  stores_matched: number;
  stores_orphaned: number;
  poll_count: number;
  change_count: number;
  last_polled_at: string;
  last_changed_at: string;
  created_at: string;
}

export interface SyncStatusResponse {
  days: SyncStateRow[];
  latest: SyncStateRow | null;
  total_snapshot_rows: number;
}

export interface SyncNowResponse {
  ok: true;
  business_date: string;
  rows_parsed: number;
  stores_matched: number;
  stores_orphaned: string[];
  upserted?: number;
  skipped?: string;
  changed: boolean;
}
