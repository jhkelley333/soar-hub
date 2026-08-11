// Hours of Operation — typed client for the store-hours function.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/store-hours";

export interface DayHours {
  day_of_week: number;      // 0=Mon .. 6=Sun
  is_closed: boolean;
  open: string | null;      // "HH:MM" (24h) or null
  close: string | null;
}
export interface HoursGridStore {
  id: string;
  number: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  days: (DayHours | null)[]; // length 7, null = not set for that day
  configured: boolean;       // any day set
  upcoming_special: number;  // count of future special-hours overrides
  google_status: "unchecked" | "match" | "mismatch" | "not_found";
  google_diffs: number;      // number of days that differ from Google
  google_checked_at: string | null;
  recon_status: "open" | "in_progress" | "resolved" | null;
  itsacheckmate_open: boolean;  // Itsacheckmate update needed & not done
  sign_open: boolean;           // sign order needed & not ordered
}

export type ReconSystem = "system" | "rap" | "itsacheckmate" | "google" | "sign";
export interface Reconciliation {
  exists: boolean;
  status: "open" | "in_progress" | "resolved";
  wrong_systems: ReconSystem[];
  action_taken: string;
  itsacheckmate_update_needed: boolean;
  itsacheckmate_done: boolean;
  sign_order_needed: boolean;
  sign_ordered: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewed_by_name?: string | null;
}
export interface GoogleCompare {
  status: "unchecked" | "match" | "mismatch" | "not_found";
  diffs: { day_of_week: number; system: string; google: string }[];
  checked_at: string | null;
  has_place?: boolean;
  hours?: DayHours[] | null;
  configured: boolean;       // Google Places API key present server-side
}
export interface SpecialHours {
  id: string;
  date: string;             // YYYY-MM-DD
  is_closed: boolean;
  open: string | null;
  close: string | null;
  note: string;
}
export interface StoreHoursDetail {
  store: { id: string; number: string; name: string; address: string | null; city: string | null; state: string | null; zip: string | null };
  standard: DayHours[];     // length 7
  special: SpecialHours[];
  updated_at: string | null;
  google: GoogleCompare;
  reconciliation: Reconciliation;
}

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
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchHoursGrid(): Promise<{ stores: HoursGridStore[]; places_configured: boolean; can_import: boolean; scoped: boolean }> {
  return request(`${FN}?action=list`);
}

export function saveReconciliation(storeId: string, r: Omit<Reconciliation, "exists" | "reviewed_by" | "reviewed_at" | "reviewed_by_name">): Promise<{ ok: boolean }> {
  return request(`${FN}?action=save-reconciliation`, { method: "POST", body: JSON.stringify({ store_id: storeId, ...r }) });
}

export interface ReconListRow {
  number: string; name: string; address: string;
  status: string | null; wrong_systems: ReconSystem[];
  itsacheckmate_open: boolean; sign_open: boolean; action_taken: string;
  days: (DayHours | null)[];
}
export function fetchReconciliationList(): Promise<{ rows: ReconListRow[] }> {
  return request(`${FN}?action=reconciliation-list`);
}
export function checkStoreGoogle(storeNumber: string): Promise<{ ok: boolean; status: GoogleCompare["status"]; diffs: GoogleCompare["diffs"]; hours: DayHours[] | null; checked_at: string; error: string | null }> {
  return request(`${FN}?action=google-check-store`, { method: "POST", body: JSON.stringify({ store: storeNumber }) });
}
export function checkAllGoogle(opts?: { since?: string; force?: boolean }): Promise<{ ok: boolean; checked: number; failed: number; remaining: number }> {
  return request(`${FN}?action=google-check-all`, { method: "POST", body: JSON.stringify(opts ?? {}) });
}
export function fetchStoreHours(storeNumber: string): Promise<StoreHoursDetail> {
  return request(`${FN}?action=get&store=${encodeURIComponent(storeNumber)}`);
}
export function saveStandardHours(storeId: string, days: DayHours[]): Promise<{ ok: boolean }> {
  return request(`${FN}?action=save-standard`, { method: "POST", body: JSON.stringify({ store_id: storeId, days }) });
}
export function saveSpecialHours(storeId: string, s: { date: string; is_closed: boolean; open: string | null; close: string | null; note: string }): Promise<{ ok: boolean }> {
  return request(`${FN}?action=save-special`, { method: "POST", body: JSON.stringify({ store_id: storeId, ...s }) });
}
export function deleteSpecialHours(id: string): Promise<{ ok: boolean }> {
  return request(`${FN}?action=delete-special`, { method: "POST", body: JSON.stringify({ id }) });
}

export interface HoursHistoryEntry {
  id: string;
  changed_at: string;
  source: string | null;   // 'edit' | 'import' | 'baseline'
  note: string | null;
  by: string | null;
  days: DayHours[];         // snapshot (may include only the days that were set)
}
export function fetchStoreHoursHistory(storeNumber: string): Promise<{ store: { number: string; name: string }; history: HoursHistoryEntry[] }> {
  return request(`${FN}?action=history&store=${encodeURIComponent(storeNumber)}`);
}

export interface BulkImportResult { ok: boolean; imported_stores: number; imported_days: number; errors: { store_number: string; reason: string }[] }
export function bulkImportHours(rows: { store_number: string; days: DayHours[] }[]): Promise<BulkImportResult> {
  return request(`${FN}?action=bulk-import`, { method: "POST", body: JSON.stringify({ rows }) });
}
