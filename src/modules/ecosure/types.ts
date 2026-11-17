export type RiskRating = "Low Risk" | "Moderate Risk" | "High Risk";

export interface EcosureStore {
  store_number: string;
  store_name: string | null;
  district: string | null;
  area: string | null;
  region: string | null;
  assessment_date: string;
  visit_type: string;
  visit_score: number | null;
  visit_rating: RiskRating | null;
  total_findings: number | null;
  imminent_risk: number | null;
  critical_findings: number | null;
  major_findings: number | null;
  minor_findings: number | null;
  report_url: string | null;
  pulled_at: string;
  days_since_audit: number;
}

export interface RiskCounts {
  "Low Risk": number;
  "Moderate Risk": number;
  "High Risk": number;
}

export interface EcosureSummaryCard {
  avg_score: number | null;
  risk_counts: RiskCounts;
  overdue_count: number;
  total_stores: number;
}

export interface TopFinding {
  question_number: string;
  standard_description: string | null;
  count: number;
}

export interface EcosureSummaryResp {
  ok: boolean;
  summary: EcosureSummaryCard | null;
  stores: EcosureStore[];
  top_findings: TopFinding[];
  as_of: string | null;
}

export interface EcosureFinding {
  assessment_date: string;
  question_number: string;
  standard_description: string | null;
  primary_response: string | null;
  primary_comment: string | null;
  pdc_response: string | null;
  pdc_comment: string | null;
}

export interface EcosureAssessment {
  id: string;
  store_number: string;
  assessment_date: string;
  visit_type: string;
  visit_score: number | null;
  visit_rating: RiskRating | null;
  total_findings: number | null;
  imminent_risk: number | null;
  critical_findings: number | null;
  major_findings: number | null;
  minor_findings: number | null;
  category_score: number | null;
  category_rating: string | null;
  report_url: string | null;
  pulled_at: string;
  findings: EcosureFinding[];
}

export interface EcosureStoreResp {
  ok: boolean;
  store_number: string;
  store_name: string | null;
  district: string | null;
  area: string | null;
  region: string | null;
  assessments: EcosureAssessment[];
}

export interface OverdueStore {
  store_number: string;
  last_audit_date: string;
  days_since_audit: number;
  store_name: string | null;
  district: string | null;
  area: string | null;
  region: string | null;
}

export interface EcosureOverdueResp {
  ok: boolean;
  overdue: OverdueStore[];
  threshold_days: number;
  as_of: string | null;
}

export interface EcosureFilters {
  region?: string;
  area?: string;
  district?: string;
}
