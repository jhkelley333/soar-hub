// Types for the Employee Action module (Training Credit + PTO requests).

export interface MyStore {
  id: string;
  number: number | string;
  name: string | null;
  district_id: string | null;
  is_active: boolean;
}

// One training day with its own start/end time. hours + amount are
// computed server-side ((end - start) hours x hourly wage) and persisted.
export interface TrainingDayEntry {
  day: string;
  start_time: string;
  end_time: string;
  hours: number;
  amount: number;
}

export interface TrainingCreditRow {
  id: string;
  submitter_id: string;
  submitter_email: string;
  submitter_name: string | null;
  store_number: string;
  store_name?: string | null;
  employee_name: string;
  hourly_wage: number;
  training_type: string;
  training_other: string | null;
  start_date: string | null;
  requested_amount: number;
  last_day_date: string | null;
  training_days: TrainingDayEntry[];
  send_copy: boolean;
  status: string;
  notes: string | null;
  // Approval (SDO/RVP single step)
  approved_at: string | null;
  approved_by_email: string | null;
  decision_note: string | null;
  rejection_reason: string | null;
  withdrawn_reason: string | null;
  // Post-approval tracking
  entered_at: string | null;
  closed_out_at: string | null;
  created_at: string;
  updated_at: string;
  // Stamped by the queue endpoint: the action this caller can take.
  action_needed?: string | null;
}

export interface PtoRow {
  id: string;
  submitter_id: string;
  submitter_email: string;
  submitter_name: string | null;
  store_number: string;
  store_name?: string | null;
  employee_name: string;
  position: string;
  pto_start_date: string;
  pto_end_date: string;
  // GM path
  days_used: number | null;
  // Hourly path (Associate Manager / First Assistant)
  hourly_wage: number | null;
  vacation_hours: number | null;
  hours_worked: number | null;
  amount: number | null;
  vacation_days: PtoVacationDay[];
  send_copy: boolean;
  /** Over the one-week-per-quarter allowance — final approval is RVP-only. */
  over_quota?: boolean;
  status: string;
  notes: string | null;
  // Approval (DO step, then SDO/RVP step)
  do_approved_at: string | null;
  do_note: string | null;
  approved_at: string | null;
  approved_by_email: string | null;
  decision_note: string | null;
  rejection_reason: string | null;
  withdrawn_reason: string | null;
  // Post-approval tracking
  paf_submitted_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  action_needed?: string | null;
}

// One vacation day. Hourly path: amount = hours x hourly wage (server-
// computed). GM path: date only (hours/amount absent) — each approved day
// credits the store's labor chart.
export interface PtoVacationDay {
  date: string;
  hours?: number | null;
  amount?: number | null;
}

// Pending-approval queue for an approver (own submissions excluded).
export interface EmployeeActionQueueResponse {
  user: { id: string; role: string };
  trainingCredits: TrainingCreditRow[];
  ptoRequests: PtoRow[];
}

export interface DecideInput {
  type: "training" | "pto";
  id: string;
  action: "approve" | "reject";
  note?: string;
}

export type ConfirmStep = "entered" | "closed-out" | "paf-submitted" | "close";

export interface ConfirmInput {
  type: "training" | "pto";
  id: string;
  step: ConfirmStep;
}

export interface EmployeeActionListResponse {
  user: { id: string; role: string; can_submit: boolean };
  trainingCredits: TrainingCreditRow[];
  ptoRequests: PtoRow[];
}

// Client sends only day + the two times; the server computes hours +
// amount + the requested-credit total.
export interface TrainingDayInput {
  day: string;
  start_time: string;
  end_time: string;
}

export interface TrainingCreditInput {
  store_number: string;
  employee_name: string;
  hourly_wage: string;
  training_type: string;
  training_other?: string;
  start_date?: string;
  last_day_date: string;
  training_days: TrainingDayInput[];
  send_copy: boolean;
}

export interface PtoVacationDayInput {
  date: string;
  hours: string;
}

// The position decides which fields are populated. GM picks the exact days
// out (gm_days — these drive the labor credit); hourly positions use
// hourly_wage + vacation_days + hours_worked.
export interface PtoInput {
  store_number: string;
  employee_name: string;
  position: string;
  send_copy: boolean;
  // GM path
  gm_days?: string[];
  // GM legacy path (old clients)
  pto_start_date?: string;
  pto_end_date?: string;
  days_used?: string;
  // Hourly path
  hourly_wage?: string;
  vacation_days?: PtoVacationDayInput[];
  hours_worked?: string;
}
