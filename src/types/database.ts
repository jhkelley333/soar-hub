// Application-level types that mirror the database schema.
// Regenerate the full Supabase types when modules are wired up:
//   npx supabase gen types typescript --linked > src/types/supabase.ts
// For now we keep a hand-written subset so the foundation compiles without
// a Supabase project being provisioned.

export type UserRole =
  | "shift_manager"
  | "gm"
  | "do"
  | "sdo"
  | "rvp"
  | "vp"
  | "coo"
  | "payroll"
  | "admin";

export type ScopeType = "store" | "district" | "area" | "region" | "global";

export interface Profile {
  id: string;
  email: string;
  phone: string | null;
  full_name: string | null;
  preferred_name: string | null;
  role: UserRole;
  primary_store_id: string | null;
  is_active: boolean;
  // Personal extras (migration 0013) — all optional.
  profile_photo_url: string | null;
  birthday: string | null;          // ISO date "YYYY-MM-DD"
  // Migration 0023 — opt-out for the dashboard birthday widget. Defaults
  // to true. Only GMs get a UI toggle; everyone else is forced to true
  // in app code (DO/SDO/RVP/Payroll/Admin don't get to hide).
  show_birthday: boolean;
  shirt_size: string | null;
  favorite_quote: string | null;
  cfm_cert_number: string | null;
  cfm_issued_at: string | null;     // ISO date
  cfm_expires_at: string | null;    // ISO date — generated column (issued + 5y)
  // Phase 0 contacts module (migration 0029):
  pinned_contact_ids: string[];
  // JSON of nav-item order; null = default order. Reserved for the
  // drag-to-reorder sidebar feature.
  sidebar_order: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface UserScope {
  id: string;
  user_id: string;
  scope_type: ScopeType;
  scope_id: string | null;
  created_at: string;
}

export type DriveThruType = "single_pole_two_menus" | "split_housing";

export interface Store {
  id: string;
  number: string;
  name: string;
  district_id: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  is_active: boolean;
  plate_iq_email: string | null;
  soar_company_name: string | null;
  food_vendor_name: string | null;
  food_vendor_contact_name: string | null;
  food_vendor_contact_phone: string | null;
  food_vendor_contact_email: string | null;
  food_vendor_account_number: string | null;
  // Active programs
  has_apple_pay: boolean;
  has_order_ahead: boolean;
  has_outdoor_seating: boolean;
  has_drive_thru: boolean;
  has_clearance_bar: boolean;
  drive_thru_lanes: number | null;
  drive_thru_type: DriveThruType | null;
  public_restroom_count: number;
  // Stall data
  patio_pop_menu_count: number;
  patio_pop_stall_numbers: string | null;
  order_ahead_stall_count: number;
  order_ahead_stall_numbers: string | null;
  stall_pop_menu_count: number;
  has_trailer_stall: boolean;
  trailer_stall_number: string | null;
  // Third-party delivery (provider keys: doordash | ubereats | grubhub | ezcater | postmates | …)
  third_party_delivery: string[];
}

// Numeric tier for UI-side comparisons. Mirrors role_level() in SQL
// (see migration 0002_add_vp_coo_roles.sql). Returns null for horizontal
// roles (payroll) so callers handle them explicitly instead of getting a
// misleading comparison result.
export function roleLevel(role: UserRole): number | null {
  switch (role) {
    case "shift_manager": return 10;
    case "gm":            return 20;
    case "do":            return 30;
    case "sdo":           return 40;
    case "rvp":           return 50;
    case "vp":            return 60;
    case "coo":           return 70;
    case "admin":         return 100;
    case "payroll":       return null;
  }
}

export const ROLE_LABELS: Record<UserRole, string> = {
  shift_manager: "Shift Manager",
  gm: "General Manager",
  do: "Director of Operations",
  sdo: "Senior Director of Operations",
  rvp: "Regional VP",
  vp: "VP",
  coo: "COO",
  payroll: "Payroll",
  admin: "Admin",
};

// ============================================================
// Contacts + Vendors (Phase 0)
// ============================================================

export type Tier = "company" | "regional" | "area" | "district" | "store";
export type ContactKind = "person" | "vendor" | "internal_team" | "corporate";
export type PosFilter = "infor" | "micros";

export interface Vendor {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  trade_category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  tier: Tier;
  region_id: string | null;
  area_id: string | null;
  district_id: string | null;
  store_id: string | null;
  preferred: boolean;
  hourly_rate: number | null;
  response_time_hours: number | null;
  w9_on_file: boolean;
  insurance_expiry: string | null; // YYYY-MM-DD
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorDoc {
  id: string;
  vendor_id: string;
  doc_type: "w9" | "insurance" | "nda" | "certification" | "other";
  storage_path: string;
  uploaded_by: string | null;
  uploaded_at: string;
  expires_at: string | null;
}

export interface Contact {
  id: string;
  display_name: string;
  contact_type: ContactKind;
  phone: string | null;
  extension: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  tier: Tier;
  region_id: string | null;
  area_id: string | null;
  district_id: string | null;
  store_id: string | null;
  vendor_id: string | null;
  pos_filter: PosFilter | null;
  created_by: string | null;
  hidden_for_store_ids: string[];
  created_at: string;
  updated_at: string;
}

// Profile fields surfaced in escalation-chain responses (Make the Right Call).
export interface EscalationProfile {
  id: string;
  email: string;
  full_name: string | null;
  preferred_name: string | null;
  phone: string | null;
  role: UserRole;
  profile_photo_url: string | null;
}

export interface EscalationChain {
  gm: EscalationProfile | null;
  do: EscalationProfile | null;
  sdo_or_rvp: EscalationProfile | null;
}
