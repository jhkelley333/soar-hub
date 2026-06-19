// Shared types for the PAF module.
//
// These mirror the snake_case columns on paf_submissions (migration
// 0016) — the netlify function stores + returns rows in this shape so
// the frontend can use them directly without renaming.

export type PafStatus =
  | "Pending"
  | "Pending SDO Approval"
  | "Approved"
  | "Rejected"
  | "Needs Approval"
  | "Needs Info"
  | "Processed";

export type PayBasis = "hourly" | "salary" | null;

export interface PafRow {
  id: string;
  config_version: number;
  submitter_id: string;
  submitter_email: string;
  submitter_name: string | null;

  pay_period_end: string;
  drive_in: string | null;
  drivein_na: boolean | null;
  /** Store name joined from `stores.name` for display only. Server-side. */
  store_name?: string | null;
  market_do: string | null;
  employee_name: string;
  last4_ssn: string;
  category: string;
  explanation: string;
  // New Hire (Salary Leader)
  nh_role: string | null;
  nh_start_date: string | null;
  nh_hours_last_period: number | string | null;
  nh_home_store: string | null;
  nh_no_market: boolean | null;
  nh_market: string | null;
  nh_area: string | null;
  nh_stores: string | null;
  nh_offer_letter_path: string | null;
  pay_basis: PayBasis;

  job_position: string | null;
  approving_mgr: string | null;
  reg_pay_rate: number | string;
  reg_hours: number | string;
  ot_hours: number | string;

  cc_tips: number | string;
  declared_tips: number | string;

  // Back pay: full | partial. Partial records what was already received.
  backpay_type?: string | null;
  backpay_paid_reg?: number | string | null;
  backpay_paid_cc_tips?: number | string | null;
  backpay_paid_declared_tips?: number | string | null;

  pto_hours: number | string;
  illness_hours: number | string;

  // Cross Store Work
  original_store: string | null;
  temp_new_store: string | null;
  store_chrged_ot: string | null;

  // Transfer
  current_store: string | null;
  new_store: string | null;
  current_position: string | null;
  new_position: string | null;

  // Demotion (current/new pay rate also used by Transfer)
  from_role: string | null;
  new_role: string | null;
  demotion_effective_date: string | null;
  current_pay_rate: number | string | null;
  new_pay_rate: number | string | null;
  location_change: boolean | null;
  new_location: string | null;

  // Termination — final_check_hrs + term_demotion kept on the row for
  // historical PAFs; new submissions write null.
  last_day_worked: string | null;
  term_demotion: string | null;
  final_check_hrs: number | string;
  termed_in_tr: string | null;

  // Bonus
  bonus_type: string | null;
  spot_bonus_amt: number | string;
  spot_bonus_reason: string | null;
  training_bonus_amt: number | string | null;
  trained_employee_name: string | null;
  trained_at_store: string | null;
  training_days: number | null;
  referral_bonus_amt: number | string | null;
  referral_tier: string | null;
  referred_employee_name: string | null;
  referral_start_date: string | null;

  status: PafStatus;
  estimated_cost: number | string;
  notes: string | null;
  rejection_reason: string | null;

  approving_email: string | null;
  approval_notes: string | null;
  action_token: string | null;
  token_expires_at: string | null;

  approved_at: string | null;
  approved_by: string | null;
  approved_by_email: string | null;
  payroll_processed_at: string | null;
  payroll_processed_by: string | null;

  // On-behalf resubmit: the leader (SDO/RVP+) who edited & resubmitted a
  // rejected PAF for the original submitter. CC'd on later outcome emails.
  // Null when the owner resubmits their own.
  resubmitted_by_id: string | null;
  resubmitted_by_email: string | null;

  // SDO bonus approval workflow
  sdo_approver_id: string | null;
  sdo_decided_at: string | null;
  sdo_decision: "approved" | "rejected" | null;
  sdo_decision_note: string | null;

  archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PafListResponse {
  user: {
    id: string;
    email: string;
    role: string;
    can_submit: boolean;
    can_process: boolean;
  };
  pafs: PafRow[];
}

// Mirrors paf_form config_json.fields field config — but only the bits
// the form needs at submit time. Full type lives in pafConfig/types.ts.
//
// Section assignment uses the `sections` array (B-2b+); the legacy
// `section` string is still readable for older config versions.
export interface PafFieldDisplay {
  label: string;
  placeholder: string;
  helpText: string;
  required: boolean;
  visible: boolean;
  locked: boolean;
  section?: string;
  sections?: string[];
}

export interface ReferralTier {
  label: string;
  amount: number;
}

export interface PafConfigDoc {
  fields: Record<string, PafFieldDisplay>;
  sections: { key: string; title: string; description: string; order: number }[];
  sectionTriggers: Record<string, string[]>;
  lists: {
    categories: string[];
    positions: string[];
    bonusTypes: string[];
    payBases?: string[];
    referralTiers?: ReferralTier[];
    statuses: string[];
    lockedStatuses: string[];
    termTypes?: string[];
  };
  emailTemplates: Record<string, { subject: string; body: string }>;
}

export interface PafConfigResponse {
  config_version: number;
  config_json: PafConfigDoc;
}

export interface PafAuditEntry {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  actor_email: string | null;
  created_at: string;
}

export interface MyStore {
  id: string;
  number: string;
  name: string | null;
  district_id: string | null;
  district_name: string | null;
  area_id: string | null;
  area_name: string | null;
  is_active: boolean;
}
