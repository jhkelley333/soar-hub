// Shared types for the PAF module.
//
// These mirror the snake_case columns on paf_submissions (migration
// 0016) — the netlify function stores + returns rows in this shape so
// the frontend can use them directly without renaming.

export type PafStatus =
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Needs Approval"
  | "Needs Info"
  | "Processed";

export interface PafRow {
  id: string;
  config_version: number;
  submitter_id: string;
  submitter_email: string;
  submitter_name: string | null;

  pay_period_end: string;
  drive_in: string;
  market_do: string | null;
  employee_name: string;
  last4_ssn: string;
  category: string;
  explanation: string;

  job_position: string | null;
  approving_mgr: string | null;
  reg_pay_rate: number | string;
  reg_hours: number | string;
  ot_hours: number | string;

  cc_tips: number | string;
  declared_tips: number | string;

  pto_hours: number | string;
  illness_hours: number | string;

  original_store: string | null;
  temp_new_store: string | null;
  store_chrged_ot: string | null;
  current_store: string | null;
  new_store: string | null;

  last_day_worked: string | null;
  term_demotion: string | null;
  final_check_hrs: number | string;
  termed_in_tr: string | null;

  spot_bonus_amt: number | string;
  bonus_type: string | null;

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
export interface PafFieldDisplay {
  label: string;
  placeholder: string;
  helpText: string;
  required: boolean;
  visible: boolean;
  locked: boolean;
  section: string;
}

export interface PafConfigDoc {
  fields: Record<string, PafFieldDisplay>;
  sections: { key: string; title: string; description: string; order: number }[];
  sectionTriggers: Record<string, string[]>;
  lists: {
    categories: string[];
    positions: string[];
    bonusTypes: string[];
    statuses: string[];
    lockedStatuses: string[];
    termTypes: string[];
  };
  emailTemplates: Record<string, { subject: string; body: string }>;
}

export interface PafConfigResponse {
  config_version: number;
  config_json: PafConfigDoc;
}
