// Typed wrappers around netlify/functions/cash-management.

import { supabase } from "@/lib/supabase";
import type {
  AlertsResponse,
  CashSettings,
  CmgConfig,
  DepositDetail,
  DsrResponse,
  LeaderOverview,
  Overview,
  PendingDeposit,
} from "./types";

const FN = "/.netlify/functions/cash-management";
export const SLIP_BUCKET = "cash-deposit-slips";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
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

const sp = (storeId?: string | null) => (storeId ? `&store_id=${encodeURIComponent(storeId)}` : "");

export function fetchOverview(storeId?: string | null): Promise<Overview> {
  return request<Overview>(`${FN}?action=overview${sp(storeId)}`);
}
export function fetchConfig(): Promise<CmgConfig> {
  return request<CmgConfig>(`${FN}?action=config`);
}
// Multi-store leader roll-up — scoped server-side to the caller's stores.
export function fetchLeaderOverview(): Promise<LeaderOverview> {
  return request<LeaderOverview>(`${FN}?action=leader-overview`);
}
// Scope-wide counts for the dashboard quick-link card.
export function fetchCashBadges(): Promise<{ pending_deposits: number; open_alerts: number; deposits_verified_today: number }> {
  return request<{ pending_deposits: number; open_alerts: number; deposits_verified_today: number }>(`${FN}?action=badges`);
}
// `deposits` is the full pending list (oldest first). `deposit` is kept on the
// shape for back-compat but always equals deposits[0] when there's at least
// one — callers should prefer `deposits` going forward.
export function fetchDeposit(storeId?: string | null): Promise<{ deposits: PendingDeposit[]; deposit: PendingDeposit | null; toleranceCents: number }> {
  return request<{ deposits: PendingDeposit[]; deposit: PendingDeposit | null; toleranceCents: number }>(`${FN}?action=deposit${sp(storeId)}`);
}
export function fetchAlerts(storeId?: string | null): Promise<AlertsResponse> {
  return request<AlertsResponse>(`${FN}?action=alerts${sp(storeId)}`);
}
export function fetchDsr(storeId?: string | null): Promise<DsrResponse> {
  return request<DsrResponse>(`${FN}?action=dsr${sp(storeId)}`);
}
export function fetchSlipUrl(depositId: string): Promise<{ url: string }> {
  return request<{ url: string }>(`${FN}?action=slip-url&deposit_id=${encodeURIComponent(depositId)}`);
}
export function fetchDetail(closeoutId: string): Promise<DepositDetail> {
  return request<DepositDetail>(`${FN}?action=detail&closeout_id=${encodeURIComponent(closeoutId)}`);
}
export function fetchSettings(): Promise<CashSettings> {
  return request<CashSettings>(`${FN}?action=settings`);
}
export function updateSettings(input: {
  closeout_tolerance_cents: number;
  deposit_tolerance_cents: number;
  // 0–23, Central Time. Closes submitted before this hour count as the
  // prior business day. Optional — omit to leave unchanged.
  business_day_cutoff_hour?: number;
}): Promise<{ ok: true; closeoutToleranceCents: number; depositToleranceCents: number; businessDayCutoffHour: number }> {
  return request(`${FN}?action=update-settings`, { method: "POST", body: JSON.stringify(input) });
}

export interface SubmitCloseoutInput {
  store_id: string;
  cash_due_cents: number;
  deposit_cents: number;
  counted_cents: number;
  denominations: Record<string, number>;
  reason?: string;
  // The closer confirmed the business date shown.
  acknowledged?: boolean;
  // Retro/late close: a prior business date (YYYY-MM-DD) being backfilled, plus
  // an optional note on why it's late. Omitted ⇒ the server uses today.
  business_date?: string;
  late_note?: string;
  // Set true to confirm "yes, this really is for today" past the wrong-day
  // fail-safe (the prior business day has no closeout yet).
  confirm_today?: boolean;
  // Required to correct an already-submitted (locked) closeout.
  correction_reason?: string;
}
// On a normal success the server returns { ok, id, … }. When the wrong-day
// fail-safe trips it instead returns { confirm_business_date, today,
// suggested_date } so the UI can ask which day this deposit is for.
export interface SubmitCloseoutResult {
  ok?: true;
  id?: string;
  flagged?: boolean;
  status?: string;
  is_late?: boolean;
  confirm_business_date?: boolean;
  today?: string;
  suggested_date?: string;
  corrected?: boolean;
  needs_unlock?: boolean;
}
export function submitCloseout(input: SubmitCloseoutInput): Promise<SubmitCloseoutResult> {
  return request(`${FN}?action=submit-closeout`, { method: "POST", body: JSON.stringify(input) });
}

// Dates in the last 7 days (excluding today) with no closeout yet — the options
// for a retro/late close.
export function fetchMissedDays(storeId?: string | null): Promise<{ missed: string[]; window_days: number }> {
  return request<{ missed: string[]; window_days: number }>(`${FN}?action=missed-days${sp(storeId)}`);
}

export interface VerifyDepositInput {
  deposit_id: string;
  bank_credited_cents: number;
  slip_path: string;
  reason?: string;
  // Carried-over open checks from the DSR, entered by the validator.
  carried_over_count?: number;
  carried_over_cents?: number;
  // Required when a nonzero carried-over is entered.
  carried_ack?: boolean;
  carried_note?: string;
}
export function verifyDeposit(
  input: VerifyDepositInput
): Promise<{ ok: true; flagged: boolean; carried_acknowledged?: boolean; carried_fwd_cents: number }> {
  return request(`${FN}?action=verify-deposit`, { method: "POST", body: JSON.stringify(input) });
}

export interface EditCloseoutInput {
  closeout_id: string;
  business_date?: string;
  cash_due_cents?: number;
  deposit_cents?: number;
  counted_cents?: number;
  reason?: string;
}
// Admin-only: fix a closeout (e.g. wrong business date).
export function editCloseout(input: EditCloseoutInput): Promise<{ ok: true }> {
  return request(`${FN}?action=edit-closeout`, { method: "POST", body: JSON.stringify(input) });
}

export function decideAlert(id: string, decision: "acknowledged" | "resolved"): Promise<{ ok: true }> {
  return request(`${FN}?action=alert-decide`, { method: "POST", body: JSON.stringify({ id, decision }) });
}

// Upload a slip photo to the private bucket; returns the storage path.
export async function uploadSlip(storeId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${storeId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(SLIP_BUCKET).upload(path, file, {
    contentType: file.type, upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}
