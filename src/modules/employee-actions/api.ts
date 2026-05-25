// Typed wrappers around netlify/functions/employee-actions.

import { supabase } from "@/lib/supabase";
import type {
  EmployeeActionListResponse,
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
