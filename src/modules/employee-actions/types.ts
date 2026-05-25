// Types for the Employee Action module (Training Credit + PTO requests).

export interface MyStore {
  id: string;
  number: number | string;
  name: string | null;
  district_id: string | null;
  is_active: boolean;
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
  training_days: string[];
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

export interface TrainingCreditInput {
  store_number: string;
  employee_name: string;
  hourly_wage: string;
  training_type: string;
  training_other?: string;
  start_date?: string;
  requested_amount: string;
  training_days: string[];
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
