// Typed wrappers around netlify/functions/employee-actions.

import { supabase } from "@/lib/supabase";
import type {
  ConfirmInput,
  DecideInput,
  EmployeeActionListResponse,
  EmployeeActionQueueResponse,
  MyStore,
  PtoInput,
  TrainingCreditInput,
} from "./types";

const FN = "/.netlify/functions/employee-actions";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = { ...(await authHeaders()), ...(init.headers ?? {}) };
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchMyStores(): Promise<{ stores: MyStore[] }> {
  return request<{ stores: MyStore[] }>(`${FN}?action=my-stores`);
}

export function listEmployeeActions(): Promise<EmployeeActionListResponse> {
  return request<EmployeeActionListResponse>(`${FN}?action=list`);
}

export function listApprovalQueue(): Promise<EmployeeActionQueueResponse> {
  return request<EmployeeActionQueueResponse>(`${FN}?action=queue`);
}

export function decideEmployeeAction(
  input: DecideInput
): Promise<{ ok: true; status: string }> {
  return request(`${FN}?action=decide`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Approve several requests in one call (approve only).
export function bulkApproveEmployeeActions(
  items: { type: "training" | "pto"; id: string }[]
): Promise<{ ok: true; approved: number; failed: number; results: { id: string | null; ok: boolean; error?: string }[] }> {
  return request(`${FN}?action=decide-bulk`, {
    method: "POST",
    body: JSON.stringify({ items, action: "approve" }),
  });
}

// Run one confirm step (e.g. "entered" = mark on weekly sheet) across many
// requests at once. Used for the bulk "Mark on weekly sheet" action.
export function bulkConfirmEmployeeActions(
  items: { type: "training" | "pto"; id: string }[],
  step: string
): Promise<{ ok: true; done: number; failed: number; results: { id: string | null; ok: boolean; error?: string }[] }> {
  return request(`${FN}?action=confirm-bulk`, {
    method: "POST",
    body: JSON.stringify({ items, step }),
  });
}

// Post-approval confirmation steps (entered / closed-out / paf-submitted).
export function confirmEmployeeAction(
  input: ConfirmInput
): Promise<{ ok: true; status: string }> {
  return request(`${FN}?action=confirm`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function submitTrainingCredit(
  input: TrainingCreditInput
): Promise<{ ok: true; id: string; status: string }> {
  return request(`${FN}?action=submit-training`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function submitPto(
  input: PtoInput
): Promise<{ ok: true; id: string; status: string }> {
  return request(`${FN}?action=submit-pto`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Resubmit a "Changes Requested" request after editing.
export function updateTrainingCredit(
  id: string,
  input: TrainingCreditInput
): Promise<{ ok: true; id: string; status: string }> {
  return request(`${FN}?action=update-training`, {
    method: "POST",
    body: JSON.stringify({ ...input, id }),
  });
}

export function updatePtoRequest(
  id: string,
  input: PtoInput
): Promise<{ ok: true; id: string; status: string }> {
  return request(`${FN}?action=update-pto`, {
    method: "POST",
    body: JSON.stringify({ ...input, id }),
  });
}

// Admin-only hard delete of a training or PTO request.
export function deleteEmployeeAction(
  type: "training" | "pto",
  id: string
): Promise<{ ok: true }> {
  return request(`${FN}?action=delete`, {
    method: "POST",
    body: JSON.stringify({ type, id }),
  });
}

// DO+ withdraws a request that's no longer needed (e.g. employee quit).
// Sets status 'Withdrawn'; reason is optional.
export function withdrawEmployeeAction(
  type: "training" | "pto",
  id: string,
  reason?: string
): Promise<{ ok: true; status: string }> {
  return request(`${FN}?action=withdraw`, {
    method: "POST",
    body: JSON.stringify({ type, id, reason: reason || undefined }),
  });
}

// ── Training credit bank ─────────────────────────────────────────────
// Every store gets a yearly budget (default $2,000) that training credit
// requests draw down. Adjustments: positive = use recorded by hand
// (historical backfill), negative = credit given back.
export interface CreditRegisterRow {
  store_number: string;
  store_name: string | null;
  budget: number;
  used_requests: number;
  used_adjustments: number;
  used: number;
  remaining: number;
}
export interface CreditRegisterResponse {
  year: number;
  default_budget: number;
  can_adjust: boolean;
  rows: CreditRegisterRow[];
}
export function fetchCreditRegister(year?: number): Promise<CreditRegisterResponse> {
  return request(`${FN}?action=credit-register${year ? `&year=${year}` : ""}`);
}
export interface CreditBalance { year: number; budget: number; used: number; remaining: number }
export function fetchCreditBalance(storeNumber: string, year?: number): Promise<CreditBalance> {
  return request(`${FN}?action=credit-balance&store_number=${encodeURIComponent(storeNumber)}${year ? `&year=${year}` : ""}`);
}
export interface CreditLedgerResponse {
  year: number;
  requests: { id: string; employee_name: string; training_type: string; requested_amount: number; status: string; start_date: string | null; created_at: string }[];
  adjustments: { id: string; amount: number; note: string | null; created_at: string }[];
}
export function fetchCreditLedger(storeNumber: string, year: number): Promise<CreditLedgerResponse> {
  return request(`${FN}?action=credit-ledger&store_number=${encodeURIComponent(storeNumber)}&year=${year}`);
}
export function adjustCredit(input: { store_number: string; year: number; amount: number; note?: string }): Promise<{ ok: true; balance: CreditBalance }> {
  return request(`${FN}?action=credit-adjust`, { method: "POST", body: JSON.stringify(input) });
}
export function setCreditBudget(input: { store_number: string; year: number; budget: number }): Promise<{ ok: true; balance: CreditBalance }> {
  return request(`${FN}?action=credit-budget`, { method: "POST", body: JSON.stringify(input) });
}
