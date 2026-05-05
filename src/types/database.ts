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
  shirt_size: string | null;
  favorite_quote: string | null;
  cfm_cert_number: string | null;
  cfm_issued_at: string | null;     // ISO date
  cfm_expires_at: string | null;    // ISO date — generated column (issued + 5y)
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

export interface Store {
  id: string;
  number: string;
  name: string;
  district_id: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  is_active: boolean;
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
