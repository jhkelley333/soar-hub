// Typed wrappers around netlify/functions/org.

import { supabase } from "@/lib/supabase";
import type { BirthdayEntry, CustomAttributes, MyTreeResponse } from "./types";
import type { UserRole } from "@/types/database";

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

// The org-level word for a role — used for the launch-splash loading
// line before the tree resolves ("Loading your market…").
export function scopeWordForRole(role: UserRole): string {
  switch (role) {
    case "gm":
    case "shift_manager":
    case "first_assistant_manager":
    case "associate_manager":
    case "crew_leader":
    case "crew_member":
    case "carhop":
      return "store";
    case "do":
      return "market";
    case "sdo":
      return "area";
    case "rvp":
      return "region";
    default:
      return "region";
  }
}

// Role-aware launch-splash label: names the user's scope level and
// counts the stores under it, from their (RLS-scoped) my-tree.
//   RVP → "Region 14 · 47 stores"   SDO → "Area 9 · 18 stores"
//   DO  → "Market 14B · 9 stores"   GM  → "SDI 4287"
// Returns null when no scope resolves (e.g. payroll), so the caller can
// fall back to the generic word.
export function launchScopeLabel(
  tree: MyTreeResponse,
  role: UserRole,
): string | null {
  const regions = tree.regions ?? [];
  const areas = regions.flatMap((r) => r.areas ?? []);
  const districts = areas.flatMap((a) => a.districts ?? []);
  const stores = districts.flatMap((d) => d.stores ?? []);
  const count = stores.length;
  if (count === 0 && regions.length === 0) return null;

  const plural = (n: number) => `${n} store${n === 1 ? "" : "s"}`;
  const named = (name: string | null, code: string | null, word: string) =>
    (name && name.trim()) || (code ? `${word} ${code}` : word);

  switch (role) {
    case "gm":
    case "shift_manager":
    case "first_assistant_manager":
    case "associate_manager":
    case "crew_leader":
    case "crew_member":
    case "carhop":
      return stores[0] ? `SDI ${stores[0].number}` : "your store";
    case "do":
      return districts.length === 1
        ? `${named(districts[0].name, districts[0].code, "Market")} · ${plural(count)}`
        : `${districts.length} markets · ${plural(count)}`;
    case "sdo":
      return areas.length === 1
        ? `${named(areas[0].name, areas[0].code, "Area")} · ${plural(count)}`
        : `${areas.length} areas · ${plural(count)}`;
    case "rvp":
      return regions.length === 1
        ? `${named(regions[0].name, regions[0].code, "Region")} · ${plural(count)}`
        : `${regions.length} regions · ${plural(count)}`;
    default:
      return regions.length === 1
        ? `${named(regions[0].name, regions[0].code, "Region")} · ${plural(count)}`
        : `${regions.length} regions · ${plural(count)}`;
  }
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
