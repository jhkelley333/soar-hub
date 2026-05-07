import {
  LayoutDashboard,
  Wrench,
  FileSpreadsheet,
  BookOpen,
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
export const NAV: NavItem[] = [
  { to: "/",            label: "Dashboard",   icon: LayoutDashboard, roles: null },
  { to: "/work-orders", label: "Work Orders", icon: Wrench,          roles: null },
  { to: "/paf",         label: "PAF",         icon: FileSpreadsheet, roles: ["do", "sdo", "rvp", "vp", "coo", "admin", "payroll"] },
  { to: "/resources",   label: "Resources",   icon: BookOpen,        roles: null },
  { to: "/team",        label: "My Team",     icon: Users,           roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/admin/org",   label: "Org Admin",   icon: Network,         roles: ["vp", "coo", "admin"] },
  { to: "/admin/paf-config", label: "PAF Config", icon: Settings,    roles: ["payroll", "admin"] },
  { to: "/ranker",      label: "Ranker",      icon: TrendingUp,      roles: ["do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/account",     label: "Account",     icon: UserCircle,      roles: null },
];

export function visibleNav(role: UserRole | undefined): NavItem[] {
  if (!role) return [];
  return NAV.filter((item) => !item.roles || item.roles.includes(role));
}
