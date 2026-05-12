// Typed wrappers around netlify/functions/org.

import { supabase } from "@/lib/supabase";
import type { BirthdayEntry, CustomAttributes, MyTreeResponse } from "./types";

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

// Store attributes — programs / drive-thru / restrooms / stall data /
// third-party delivery / free-form custom attributes bag. Accessible
// from My Stores → store detail to admin / payroll / vp / coo / do /
// sdo / rvp.
export interface StoreAttributesEditableFields {
  has_apple_pay: boolean;
  has_order_ahead: boolean;
  has_outdoor_seating: boolean;
  has_drive_thru: boolean;
  has_clearance_bar: boolean;
  drive_thru_lanes: number | null;
  drive_thru_type: string | null;
  public_restroom_count: number;
  patio_pop_menu_count: number;
  patio_pop_stall_numbers: string | null;
  order_ahead_stall_count: number;
  order_ahead_stall_numbers: string | null;
  stall_pop_menu_count: number;
  has_trailer_stall: boolean;
  trailer_stall_number: string | null;
  third_party_delivery: string[];
  // Free-form key/value bag. Sending this replaces the existing
  // attributes object entirely on the row.
  attributes: CustomAttributes;
}

export interface UpdateStoreAttributesResponse {
  store: { id: string } & StoreAttributesEditableFields;
  changed: number;
}

export function updateStoreAttributes(
  storeId: string,
  fields: Partial<StoreAttributesEditableFields>
): Promise<UpdateStoreAttributesResponse> {
  return request<UpdateStoreAttributesResponse>(
    `${FN}?action=update-store-attributes`,
    {
      method: "POST",
      body: JSON.stringify({ store_id: storeId, ...fields }),
    }
  );
}
