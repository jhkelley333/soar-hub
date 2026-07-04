// Typed wrappers around netlify/functions/labor.

import { supabase } from "@/lib/supabase";
import type {
  DistrictLaborResponse,
  GmLaborResponse,
  LaborDistrict,
  LaborStore,
  ReviewInput,
  SyncNowResponse,
  SyncStatusResponse,
} from "./types";

const FN = "/.netlify/functions/labor";

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

export function fetchLaborStores(): Promise<{ stores: LaborStore[] }> {
  return request<{ stores: LaborStore[] }>(`${FN}?action=my-stores`);
}

export function fetchGmLabor(
  store: string,
  date?: string
): Promise<GmLaborResponse> {
  const q = new URLSearchParams({ action: "gm", store });
  if (date) q.set("date", date);
  return request<GmLaborResponse>(`${FN}?${q.toString()}`);
}

export function fetchLaborDistricts(): Promise<{ districts: LaborDistrict[] }> {
  return request<{ districts: LaborDistrict[] }>(`${FN}?action=districts`);
}

export function fetchDistrictLabor(
  date?: string,
  district?: string
): Promise<DistrictLaborResponse> {
  const q = new URLSearchParams({ action: "district" });
  if (date) q.set("date", date);
  if (district) q.set("district", district);
  return request<DistrictLaborResponse>(`${FN}?${q.toString()}`);
}

export function saveLaborReview(
  input: ReviewInput
): Promise<{ ok: true; review: { id: string; note: string } }> {
  return request(`${FN}?action=review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchSyncStatus(): Promise<SyncStatusResponse> {
  return request<SyncStatusResponse>(`${FN}?action=sync-status`);
}

export function triggerSyncNow(): Promise<SyncNowResponse> {
  return request<SyncNowResponse>(`${FN}?action=sync-now`, { method: "POST" });
}

// Diagnostic dry-run — reads the sheet, parses the column map, returns up to
// 3 mapped sample rows. No DB writes. Used by the Pull Log admin to confirm
// which sheet columns we're reading for each band when suspect values appear.
export interface SyncDryRunResponse {
  ok: true;
  business_date: string;
  rows_parsed: number;
  stores_matched: number;
  stores_orphaned: string[];
  column_map: {
    di: string | null;
    location: string | null;
    gm: string | null;
    do: string | null;
    sdo: string | null;
    rvp: string | null;
    base_ptd_labor_goal: string | null;
    daily: Record<string, string | null>;
    wtd: Record<string, string | null>;
    ptd: Record<string, string | null>;
  };
  sample: Record<string, unknown>[];
  // Sheet-vs-app comparison for the sheet's current Sales Date: does what's
  // stored match what the sheet parses to right now?
  verify?: {
    stored_rows_for_date: number;
    identical: number;
    differing: number;
    missing_in_db: number;
    last_stored_sync: string | null;
    mismatches: {
      store_number: string;
      fields: Record<string, { sheet: number | null; app: number | null }>;
    }[];
  };
}
export function triggerSyncDryRun(): Promise<SyncDryRunResponse> {
  return request<SyncDryRunResponse>(`${FN}?action=sync-dry`, { method: "POST" });
}
