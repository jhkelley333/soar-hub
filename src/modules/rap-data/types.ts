export interface RapScoreRow {
  store_number: string;
  store_name: string | null;
  district: string | null;
  area: string | null;
  region: string | null;
  period_start: string;
  period_end: string;
  scope: "mtd" | "rolling3" | "month_final";
  ltr: number | null;
  osat: number | null;
  doordash: number | null;
  google: number | null;
  grubhub: number | null;
  ubereats: number | null;
  other: number | null;
  avg_stars: number | null;
  pulled_at: string;
}

export interface RapScoresResp {
  ok: boolean;
  scope: string;
  rows: RapScoreRow[];
  as_of: string | null;
}

export interface RapHistoryPoint {
  period_start: string;
  ltr: number | null;
  osat: number | null;
}

export interface RapReview {
  id: string;
  store_number: string;
  store_name: string | null;
  channel: string;
  review_date: string;
  review_text: string | null;
  pii_possible: boolean;
  first_seen_at: string;
}

export interface RapStoreResp {
  ok: boolean;
  store_number: string;
  store_name: string | null;
  history: RapHistoryPoint[];
  reviews: RapReview[];
}

export interface RapReviewsResp {
  ok: boolean;
  reviews: RapReview[];
  hasMore: boolean;
  page: number;
}

export const SCOPE_LABELS: Record<string, string> = {
  mtd: "Month to Date",
  rolling3: "Rolling 3 Months",
  month_final: "Last Month",
};
