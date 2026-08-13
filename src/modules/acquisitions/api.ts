// Acquisitions — typed client for the acquisitions function (admin/vp/coo).
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/acquisitions";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export type AcquisitionStatus = "draft" | "merged";

export interface Acquisition {
  id: string;
  name: string;
  close_date: string | null;
  status: AcquisitionStatus;
  notes: string | null;
  created_at: string;
  merged_at: string | null;
  store_count: number;
  merged_count: number;
}

export interface AcqStoreInput {
  store_number: string;
  name?: string; address?: string; city?: string; state?: string; zip?: string; phone?: string;
  region_name?: string; area_name?: string; district_name?: string;
  gm_name?: string; gm_email?: string; gm_phone?: string; notes?: string;
}
export interface AcqStore extends AcqStoreInput {
  id: string;
  issues: string[];
  merged: boolean;
  merged_store_id: string | null;
}
export interface AcqSummary { total: number; mergeable: number; blocked: number; merged: number }

export function fetchAcquisitions(): Promise<{ rows: Acquisition[] }> { return req(`${FN}?action=list`); }
export function fetchAcquisition(id: string): Promise<{ acquisition: Acquisition; stores: AcqStore[]; summary: AcqSummary }> {
  return req(`${FN}?action=get&id=${encodeURIComponent(id)}`);
}
export function createAcquisition(input: { name: string; close_date?: string; notes?: string }): Promise<{ ok: true; id: string }> {
  return req(`${FN}?action=create`, { method: "POST", body: JSON.stringify(input) });
}
export function updateAcquisition(id: string, patch: { name?: string; close_date?: string | null; notes?: string }): Promise<{ ok: true }> {
  return req(`${FN}?action=update`, { method: "POST", body: JSON.stringify({ id, ...patch }) });
}
export function deleteAcquisition(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=delete`, { method: "POST", body: JSON.stringify({ id }) });
}
export function uploadStores(id: string, rows: AcqStoreInput[]): Promise<{ ok: true; staged: number }> {
  return req(`${FN}?action=upload`, { method: "POST", body: JSON.stringify({ id, rows }) });
}
export function updateStore(storeId: string, fields: Partial<AcqStoreInput>): Promise<{ ok: true }> {
  return req(`${FN}?action=update-store`, { method: "POST", body: JSON.stringify({ store_id: storeId, ...fields }) });
}
export function deleteStore(storeId: string): Promise<{ ok: true }> {
  return req(`${FN}?action=delete-store`, { method: "POST", body: JSON.stringify({ store_id: storeId }) });
}
export function mergeAcquisition(id: string): Promise<{ ok: true; created: number; skipped: { store_number: string; reason: string }[] }> {
  return req(`${FN}?action=merge`, { method: "POST", body: JSON.stringify({ id }) });
}
export function unmergeAcquisition(id: string): Promise<{ ok: true; deactivated: number }> {
  return req(`${FN}?action=unmerge`, { method: "POST", body: JSON.stringify({ id }) });
}
