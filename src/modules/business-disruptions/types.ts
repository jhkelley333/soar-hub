// Business Disruption Reporting — shared types (mirror business-disruptions.js).

export const CLOSURE_TYPES = [
  "Weather", "Power Outage", "Equipment Failure", "Staffing", "Plumbing",
  "Fire/Safety", "Robbery/Theft", "Vandalism", "Health Department",
  "Internet Issue", "POS Issues", "Connectivity Issues", "Other",
] as const;

export const ISSUE_TYPES = [
  "Slip/Fall", "Food Safety", "Equipment", "Vehicle Accident", "Altercation", "Other",
] as const;

// Closure/Disruption Type selections that trigger their own follow-up field.
// Mirror business-disruptions.js's SOLUGENIX_TRIGGER / WO_TRIGGER exactly.
export const SOLUGENIX_TRIGGER_TYPES = new Set(["Internet Issue", "POS Issues", "Connectivity Issues"]);
export const WO_TRIGGER_TYPES = new Set(["Plumbing", "Vandalism", "Equipment Failure", "Other"]);

export type DisruptionStatus = "open" | "reviewed" | "closed";

export interface Attachment {
  name: string;
  type: string;
  url: string | null;
}

export interface DisruptionReport {
  id: string;
  disruption_date: string;
  store_id: string;
  store_number: string;
  store_name: string | null;
  district_manager_id: string | null;
  district_manager_name: string | null;
  hours_disrupted: number | null;
  store_closed: boolean;
  reopen_date: string | null;
  order_ahead_disabled: boolean;
  closure_types: string[];
  closure_other_detail: string | null;
  employee_injured: boolean;
  store_damaged: boolean;
  customer_injured: boolean;
  issue_types: string[];
  solugenix_case_number: string | null;
  work_order_filed: boolean | null;
  work_order_ticket_id: string | null;
  work_order_number: string | null;
  estimated_loss_sales: number;
  description: string;
  attachments: Attachment[];
  escalated_to_rvp_name: string | null;
  status: DisruptionStatus;
  submitted_by: string | null;
  submitted_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  can_review: boolean;
  can_edit: boolean;
}

export interface StorePick {
  id: string;
  number: string;
  name: string | null;
}

export interface WoPick {
  id: string;
  wo_number: string;
  work_requested: string | null;
  status: string;
}
