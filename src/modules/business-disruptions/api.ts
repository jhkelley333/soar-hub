// Typed wrappers around netlify/functions/business-disruptions.
import { supabase } from "@/lib/supabase";
import { compressPhoto } from "@/modules/reno-scoping/photoCompress";
import type { DisruptionStatus, DmPick, StorePick } from "./types";

const FN = "/.netlify/functions/business-disruptions";

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

export interface FilePayload { data: string; type: string; name: string }

// Images get compressed (same pipeline as Site Audits); non-image files
// (PDFs) pass through untouched.
export async function fileToPayload(file: File): Promise<FilePayload> {
  let blob: Blob = file;
  let name = file.name;
  if (file.type.startsWith("image/")) {
    try {
      const c = await compressPhoto(file);
      blob = c.blob;
      name = c.filename;
    } catch {
      /* fall back to the original file if canvas decode fails */
    }
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ data: String(r.result), type: blob.type || file.type || "application/octet-stream", name });
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsDataURL(blob);
  });
}

export interface DisruptionsResponse { reports: import("./types").DisruptionReport[]; can_write: boolean; can_review: boolean }
export function fetchDisruptions(): Promise<DisruptionsResponse> {
  return request<DisruptionsResponse>(`${FN}?action=list`);
}
export function fetchDisruptionStores(): Promise<{ stores: StorePick[] }> {
  return request(`${FN}?action=stores`);
}
export function fetchDistrictManagers(): Promise<{ dms: DmPick[] }> {
  return request(`${FN}?action=dms`);
}

export interface CreateDisruptionInput {
  disruption_date: string;
  store_number: string;
  district_manager_id: string;
  hours_disrupted?: number | string | null;
  store_closed: boolean;
  reopen_date?: string | null;
  order_ahead_disabled: boolean;
  closure_types: string[];
  closure_other_detail?: string;
  employee_injured: boolean;
  store_damaged: boolean;
  customer_injured: boolean;
  issue_types: string[];
  estimated_loss_sales: number | string;
  description: string;
  attachments: FilePayload[];
}
export function createDisruption(input: CreateDisruptionInput): Promise<{ ok: true; id: string }> {
  return request(`${FN}?action=create`, { method: "POST", body: JSON.stringify(input) });
}
export function setDisruptionStatus(id: string, status: DisruptionStatus): Promise<{ ok: true }> {
  return request(`${FN}?action=set-status`, { method: "POST", body: JSON.stringify({ id, status }) });
}
