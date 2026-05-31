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
  sales: number | null;
  variance_pts: number | null;
  dollars_over_chart: number | null;
  hours_over_chart: number | null;
  chart_dollars_allowed: number | null;
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
  labor_pct: number | null;
  variance_pts: number | null;
  dollars_over_chart: number | null;
  hours_over_chart: number | null;
  status: ChartStatus;
  explained: boolean;
  note_due: boolean;
  note: string | null;
}

export interface DistrictRollup {
  store_count: number;
  district_labor_pct: number | null;
  stores_over_chart: number;
  dollars_over_chart: number;
  hours_over_chart: number;
  notes_due: number;
  notes_explained: number;
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
