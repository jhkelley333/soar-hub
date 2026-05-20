import {
  LayoutDashboard,
  Wrench,
  FileSpreadsheet,
  BookOpen,
  BookUser,
  Building2,
  Users,
  Network,
  TrendingUp,
  UserCircle,
  Settings,
  Layers,
  Hammer,
  Flag,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/types/database";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  // null = visible to everyone signed in
  roles: UserRole[] | null;
  // Optional override: if set, the item is also visible to any user
  // for whom this feature flag resolves to ON — even if their role
  // wouldn't normally qualify. Used to give specific testers access
  // during a pilot without changing the role allowlist.
  flagKey?: string;
}

// Single source of truth for the sidebar. Adding a module = adding a row.
//
// Payroll is intentionally a focused, single-purpose role: their workday
// is the PAF queue. Hiding everything else keeps that focus and avoids
// confusion with org-tree or work-order modules they don't operate.
export const NAV: NavItem[] = [
  { to: "/",            label: "Dashboard",   icon: LayoutDashboard, roles: ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/ranker",      label: "Ranker",      icon: TrendingUp,      roles: ["do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/work-orders", label: "Work Orders", icon: Wrench,          roles: ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  // PAF is currently in pilot mode — only payroll + admin by role. The
  // paf_pilot flag widens this to specific hand-picked testers (DOs,
  // RVPs, etc.) without code changes; admins add user IDs from
  // /admin/feature-flags. To return to the previous "DO and up" rule,
  // delete the flagKey here and add the original roles back to roles.
  { to: "/paf",         label: "PAF",         icon: FileSpreadsheet, roles: ["payroll", "admin"], flagKey: "paf_pilot" },
  { to: "/contacts",    label: "Contacts",    icon: BookUser,        roles: null },
  { to: "/resources",   label: "Resources",   icon: BookOpen,        roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/team",        label: "My Team",     icon: Users,           roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/my-stores",   label: "My Stores",   icon: Building2,       roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"] },
  { to: "/admin/org",   label: "Org Admin",   icon: Network,         roles: ["vp", "coo", "admin"] },
  { to: "/admin/bulk-attributes", label: "Bulk Attributes", icon: Layers, roles: ["admin"] },
  { to: "/admin/feature-flags",   label: "Feature Flags",   icon: Flag,   roles: ["admin"] },
  { to: "/admin/paf-config", label: "PAF Config", icon: Settings,    roles: ["payroll", "admin"] },
  // BETA — Work Orders V2 module opened to field roles for live testing.
  // Excludes payroll (focused PAF role); excluded from "admin/" path
  // grouping but the URL is preserved to avoid breaking deep links.
  { to: "/admin/work-orders-v2", label: "Work Orders V2 (BETA)", icon: Hammer, roles: ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/account",     label: "Account",     icon: UserCircle,      roles: null },
];

export function visibleNav(
  role: UserRole | undefined,
  flags: Record<string, boolean> = {},
): NavItem[] {
  if (!role) return [];
  return NAV.filter((item) => {
    if (!item.roles) return true;
    if (item.roles.includes(role)) return true;
    if (item.flagKey && flags[item.flagKey]) return true;
    return false;
  });
}

// Where to land each role after sign-in. Payroll skips Dashboard
// (which they don't see anyway) and lands on the PAF queue.
export function defaultLandingPath(role: UserRole | undefined): string {
  if (role === "payroll") return "/paf/queue";
  return "/";
}
