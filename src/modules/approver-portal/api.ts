// Approver Portal client. Portal calls (resolve / listPending / decide) are
// token-authenticated — no Supabase JWT. Admin calls (mint / list / revoke)
// carry the minter's Bearer JWT.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/approver-portal";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: boolean; error?: string }).error) {
    throw new Error((body as { message?: string; error?: string }).message
      || (body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return body as T;
}

async function authed<T>(url: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return getJson<T>(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
}

// ── portal (token) ──

export interface ApproverIdentity {
  name: string;
  role: string;
}
export interface PendingApproval {
  approvalId: string;
  ticketId: string;
  woNumber: string | null;
  storeNumber: string | null;
  storeName: string | null;
  title: string;
  workRequested: string | null;
  priority: string | null;
  tier: string;
  requestedBy: string | null;
  requestNotes: string | null;
  amountCents: number;
  quoteId: string | null;
  vendorName: string | null;
  createdAt: string;
}

export function resolveApprover(token: string): Promise<{ ok: true; approver: ApproverIdentity; label: string | null }> {
  return getJson(`${FN}?action=resolve&token=${encodeURIComponent(token)}`);
}

export function listPendingApprovals(token: string): Promise<{ approver: ApproverIdentity; pending: PendingApproval[] }> {
  return getJson(`${FN}?action=listPending&token=${encodeURIComponent(token)}`);
}

export function decideApproval(payload: {
  token: string;
  approvalId: string;
  ticketId: string;
  decision: "Approved" | "Rejected";
  notes?: string;
  quoteId?: string | null;
  verbal?: boolean;
}): Promise<{ ok: true }> {
  return getJson(`${FN}?action=decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

// ── admin (Bearer JWT) ──

export interface ApproverCandidate {
  id: string;
  name: string;
  role: string;
  email: string | null;
}
export interface ApproverTokenRow {
  id: string;
  token: string;
  label: string | null;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  approverName: string;
  approverRole: string | null;
}

export function listApproverCandidates(): Promise<{ approvers: ApproverCandidate[] }> {
  return authed(`${FN}?action=adminApprovers`);
}
export function listApproverTokens(): Promise<{ tokens: ApproverTokenRow[] }> {
  return authed(`${FN}?action=adminList`);
}
export function createApproverToken(body: { approver_id: string; label?: string; ttl_days?: number }): Promise<{ ok: true; id: string; token: string }> {
  return authed(`${FN}?action=adminCreate`, { method: "POST", body: JSON.stringify(body) });
}
export function revokeApproverToken(id: string): Promise<{ ok: true }> {
  return authed(`${FN}?action=adminRevoke`, { method: "POST", body: JSON.stringify({ id }) });
}

export function approverPortalUrl(token: string): string {
  return `${window.location.origin}/a/${token}`;
}
