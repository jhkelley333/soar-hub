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
  training_days: TrainingDayEntry[];
  send_copy: boolean;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PtoRow {
  id: string;
  submitter_id: string;
  submitter_email: string;
  submitter_name: string | null;
  store_number: string;
  store_name?: string | null;
  gm_name: string;
  pto_start_date: string;
  pto_end_date: string;
  days_used: number;
  send_copy: boolean;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
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
  training_days: TrainingDayInput[];
  send_copy: boolean;
}

export interface PtoInput {
  store_number: string;
  gm_name: string;
  pto_start_date: string;
  pto_end_date: string;
  days_used: string;
  send_copy: boolean;
}
