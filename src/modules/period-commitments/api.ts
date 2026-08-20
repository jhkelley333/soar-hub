// RVP period commitments — client for netlify/functions/rvp-period-commitments.
// Free-text commitments per fiscal period, with an editable target/status and
// an immutable edit history recorded server-side (Phase 6). Distinct from the
// metric-target "RVP Commitments" scoreboard.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/rvp-period-commitments";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export type CommitmentStatus = "active" | "met" | "missed";

export interface CommitmentHistoryRow {
  id: string;
  commitment_id: string;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
}

export interface PeriodCommitment {
  id: string;
  rvp_user_id: string;
  rvp_name: string | null;
  fiscal_year: string;
  period: number;
  commitment_text: string;
  target_value: number | null;
  target_unit: string | null;
  status: CommitmentStatus;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  history: CommitmentHistoryRow[];
}

export interface RvpOption { id: string; full_name: string | null }

export interface CommitmentListResponse {
  ok: true;
  commitments: PeriodCommitment[];
  rvps: RvpOption[];
  scope: "all" | "own";
  self_id: string;
}

export function fetchPeriodCommitments(fiscalYear: string, period: number): Promise<CommitmentListResponse> {
  return req(`${FN}?action=list&fiscal_year=${encodeURIComponent(fiscalYear)}&period=${period}`);
}

export interface CreateCommitmentInput {
  fiscal_year: string;
  period: number;
  commitment_text: string;
  target_value?: number | null;
  target_unit?: string | null;
  status?: CommitmentStatus;
  rvp_user_id?: string;
}
export function createPeriodCommitment(input: CreateCommitmentInput): Promise<{ ok: true; commitment: PeriodCommitment }> {
  return req(`${FN}?action=create`, { method: "POST", body: JSON.stringify(input) });
}

export interface UpdateCommitmentInput {
  id: string;
  commitment_text?: string;
  target_value?: number | null;
  target_unit?: string | null;
  status?: CommitmentStatus;
}
export function updatePeriodCommitment(input: UpdateCommitmentInput): Promise<{ ok: true; commitment: PeriodCommitment }> {
  return req(`${FN}?action=update`, { method: "POST", body: JSON.stringify(input) });
}
