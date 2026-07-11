// Typed wrappers around netlify/functions/paf.

import { supabase } from "@/lib/supabase";
import type {
  MyStore,
  PafAuditEntry,
  PafConfigResponse,
  PafListResponse,
  PafRow,
} from "./types";

const FN = "/.netlify/functions/paf";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  withAuth = true
): Promise<T> {
  const headers = withAuth
    ? { ...(await authHeaders()), ...(init.headers ?? {}) }
    : { "Content-Type": "application/json", ...(init.headers ?? {}) };
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

export function listPafs(): Promise<PafListResponse> {
  return request<PafListResponse>(`${FN}?action=list`);
}

export function fetchPafConfig(): Promise<PafConfigResponse> {
  return request<PafConfigResponse>(`${FN}?action=config`);
}

export function fetchPafAudit(id: string): Promise<{ entries: PafAuditEntry[] }> {
  return request<{ entries: PafAuditEntry[] }>(
    `${FN}?action=audit-log&id=${encodeURIComponent(id)}`
  );
}

export function fetchMyStores(): Promise<{ stores: MyStore[] }> {
  return request<{ stores: MyStore[] }>(`${FN}?action=my-stores`);
}

export function fetchOfferLetterUrl(id: string): Promise<{ url: string }> {
  return request<{ url: string }>(
    `${FN}?action=offer-letter-url&id=${encodeURIComponent(id)}`
  );
}

export type PafSubmitInput = Partial<
  Omit<
    PafRow,
    | "id"
    | "config_version"
    | "submitter_id"
    | "submitter_email"
    | "submitter_name"
    | "status"
    | "estimated_cost"
    | "approving_email"
    | "approval_notes"
    | "action_token"
    | "token_expires_at"
    | "approved_at"
    | "approved_by"
    | "approved_by_email"
    | "resubmitted_by_id"
    | "resubmitted_by_email"
    | "payroll_processed_at"
    | "payroll_processed_by"
    | "archived"
    | "archived_at"
    | "created_at"
    | "updated_at"
  >
> & {
  pay_period_end: string;
  drive_in: string;
  employee_name: string;
  last4_ssn: string;
  category: string;
  explanation: string;
};

export function submitPaf(
  input: PafSubmitInput
): Promise<{ ok: true; id: string; status: string; late?: boolean; process_week?: string; cutoff_at?: string }> {
  return request<{ ok: true; id: string; status: string }>(`${FN}?action=submit`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Edit + resubmit a rejected PAF (same record). Server gates this to the
// original submitter and requires the PAF be in "Rejected" status.
export function resubmitPaf(
  id: string,
  input: PafSubmitInput
): Promise<{ ok: true; id: string; status: string; late?: boolean; process_week?: string; cutoff_at?: string }> {
  return request<{ ok: true; id: string; status: string }>(
    `${FN}?action=resubmit`,
    {
      method: "POST",
      body: JSON.stringify({ ...input, id }),
    }
  );
}

// ── Payroll cutoff ────────────────────────────────────────────────────
export interface CutoffInfo {
  late: boolean;
  process_week: string;
  cutoff_at: string;
  week_sunday: string;
  overridden: boolean;
}
export function fetchCutoffInfo(): Promise<CutoffInfo> {
  return request<CutoffInfo>(`${FN}?action=cutoff-info`);
}
export interface CutoffOverride { week_sunday: string; cutoff_at: string; note: string | null; created_at: string }
export function listCutoffs(): Promise<{ default_rule: string; this_week_sunday: string; overrides: CutoffOverride[] }> {
  return request(`${FN}?action=list-cutoffs`);
}
export function setCutoff(input: { week_sunday: string; cutoff_date: string; cutoff_time: string; note?: string }): Promise<{ ok: true }> {
  return request(`${FN}?action=cutoff-set`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteCutoff(weekSunday: string): Promise<{ ok: true }> {
  return request(`${FN}?action=cutoff-delete`, { method: "POST", body: JSON.stringify({ week_sunday: weekSunday }) });
}

export function listSdoQueue(): Promise<{ pafs: PafRow[] }> {
  return request<{ pafs: PafRow[] }>(`${FN}?action=list-sdo-queue`);
}

export function sdoApprovePaf(id: string, note?: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=sdo-approve`, {
    method: "POST",
    body: JSON.stringify({ id, note }),
  });
}

export function sdoRejectPaf(id: string, reason: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=sdo-reject`, {
    method: "POST",
    body: JSON.stringify({ id, reason }),
  });
}

export function rejectPaf(id: string, reason: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=reject`, {
    method: "POST",
    body: JSON.stringify({ id, reason }),
  });
}

export function deletePaf(id: string, reason: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=delete`, {
    method: "POST",
    body: JSON.stringify({ id, reason }),
  });
}

// Manually nudge the assigned approver (when a quick response is needed).
// Emails them, and also texts when Telnyx is configured. `channels` reports
// which actually went out.
export function textPafApprover(
  id: string
): Promise<{ ok: true; to: string; channels: ("email" | "text")[] }> {
  return request<{ ok: true; to: string; channels: ("email" | "text")[] }>(
    `${FN}?action=text-approver`,
    {
      method: "POST",
      body: JSON.stringify({ id }),
    }
  );
}

export function needsApprovalPaf(
  id: string,
  approval_email: string,
  notes?: string
): Promise<{ ok: true; approval_link: string; expires_at: string }> {
  return request<{ ok: true; approval_link: string; expires_at: string }>(
    `${FN}?action=needs-approval`,
    {
      method: "POST",
      body: JSON.stringify({ id, approval_email, notes }),
    }
  );
}

export function markProcessedPaf(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=mark-processed`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function tokenApprovePaf(
  token: string,
  email?: string
): Promise<{ ok: true; employee_name: string; drive_in: string }> {
  return request<{ ok: true; employee_name: string; drive_in: string }>(
    `${FN}?action=token-approve`,
    {
      method: "POST",
      body: JSON.stringify({ token, email }),
    },
    /* withAuth */ false
  );
}
