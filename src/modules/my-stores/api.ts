// Typed wrappers around netlify/functions/org.

import { supabase } from "@/lib/supabase";
import type { BirthdayEntry, MyTreeResponse } from "./types";

const FN = "/.netlify/functions/org";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
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

export function fetchMyTree(): Promise<MyTreeResponse> {
  return request<MyTreeResponse>(`${FN}?action=my-tree`);
}

export function fetchBirthdays(start: string, end: string): Promise<{ entries: BirthdayEntry[] }> {
  return request<{ entries: BirthdayEntry[] }>(
    `${FN}?action=birthdays&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );
}

export interface VendorEditableFields {
  food_vendor_name: string | null;
  food_vendor_contact_name: string | null;
  food_vendor_contact_phone: string | null;
  food_vendor_contact_email: string | null;
  food_vendor_account_number: string | null;
}

export interface UpdateStoreVendorResponse {
  store: { id: string } & VendorEditableFields;
  changed: number;
}

export function updateStoreVendor(
  storeId: string,
  fields: Partial<VendorEditableFields>
): Promise<UpdateStoreVendorResponse> {
  return request<UpdateStoreVendorResponse>(`${FN}?action=update-store-vendor`, {
    method: "POST",
    body: JSON.stringify({ store_id: storeId, ...fields }),
  });
}

export interface StoreVendorAuditEntry {
  id: string;
  store_id: string;
  field: keyof VendorEditableFields;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  actor: {
    id: string | null;
    name: string | null;
    role: string | null;
  };
  actor_email: string | null;
}

export interface StoreVendorAuditResponse {
  entries: StoreVendorAuditEntry[];
}

export function fetchStoreVendorAudit(
  storeId: string,
  limit = 50
): Promise<StoreVendorAuditResponse> {
  const params = new URLSearchParams({ store_id: storeId, limit: String(limit) });
  return request<StoreVendorAuditResponse>(
    `${FN}?action=store-vendor-audit&${params.toString()}`
  );
}
