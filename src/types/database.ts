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
  | "payroll"
  | "admin";

export type ScopeType = "store" | "district" | "market" | "region" | "global";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  primary_store_id: string | null;
  is_active: boolean;
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
  city: string | null;
  state: string | null;
  is_active: boolean;
}

// Numeric tier for UI-side comparisons. Mirrors role_level() in SQL.
// Returns null for horizontal roles (payroll) so callers handle them
// explicitly instead of getting a misleading comparison result.
export function roleLevel(role: UserRole): number | null {
  switch (role) {
    case "shift_manager": return 10;
    case "gm":            return 20;
    case "do":            return 30;
    case "sdo":           return 40;
    case "rvp":           return 50;
    case "admin":         return 100;
    case "payroll":       return null;
  }
}

export const ROLE_LABELS: Record<UserRole, string> = {
  shift_manager: "Shift Manager",
  gm: "General Manager",
  do: "District Operator",
  sdo: "Senior District Operator",
  rvp: "Regional VP",
  payroll: "Payroll",
  admin: "Admin",
};
