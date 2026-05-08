import {
  LayoutDashboard,
  Wrench,
  FileSpreadsheet,
  BookOpen,
  Building2,
  Users,
  Network,
  TrendingUp,
  UserCircle,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/types/database";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  // null = visible to everyone signed in
  roles: UserRole[] | null;
}

// Single source of truth for the sidebar. Adding a module = adding a row.
//
// Payroll is intentionally a focused, single-purpose role: their workday
// is the PAF queue. Hiding everything else keeps that focus and avoids
// confusion with org-tree or work-order modules they don't operate.
export const NAV: NavItem[] = [
  { to: "/",            label: "Dashboard",   icon: LayoutDashboard, roles: ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/work-orders", label: "Work Orders", icon: Wrench,          roles: ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/paf",         label: "PAF",         icon: FileSpreadsheet, roles: ["do", "sdo", "rvp", "vp", "coo", "admin", "payroll"] },
  { to: "/resources",   label: "Resources",   icon: BookOpen,        roles: ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/team",        label: "My Team",     icon: Users,           roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/my-stores",   label: "My Stores",   icon: Building2,       roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"] },
  { to: "/admin/org",   label: "Org Admin",   icon: Network,         roles: ["vp", "coo", "admin"] },
  { to: "/admin/paf-config", label: "PAF Config", icon: Settings,    roles: ["payroll", "admin"] },
  { to: "/ranker",      label: "Ranker",      icon: TrendingUp,      roles: ["do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/account",     label: "Account",     icon: UserCircle,      roles: null },
];

export function visibleNav(role: UserRole | undefined): NavItem[] {
  if (!role) return [];
  return NAV.filter((item) => !item.roles || item.roles.includes(role));
}

// Where to land each role after sign-in. Payroll skips Dashboard
// (which they don't see anyway) and lands on the PAF queue.
export function defaultLandingPath(role: UserRole | undefined): string {
  if (role === "payroll") return "/paf/queue";
  return "/";
}
