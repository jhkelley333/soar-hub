// Business Disruption Reporting — shared types (mirror business-disruptions.js).

export const CLOSURE_TYPES = [
  "Weather", "Power Outage", "Equipment Failure", "Staffing", "Plumbing",
  "Fire/Safety", "Robbery/Theft", "Vandalism", "Health Department",
  "Internet Issue", "POS Issues", "Connectivity Issues", "Other",
] as const;

export const ISSUE_TYPES = [
  "Slip/Fall", "Food Safety", "Equipment", "Vehicle Accident", "Altercation", "Other",
] as const;

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
  estimated_loss_sales: number;
  description: string;
  attachments: Attachment[];
  status: DisruptionStatus;
  submitted_by: string | null;
  submitted_by_name: string | null;
  created_at: string;
  updated_at: string;
  can_review: boolean;
}

export interface StorePick {
  id: string;
  number: string;
  name: string | null;
}
