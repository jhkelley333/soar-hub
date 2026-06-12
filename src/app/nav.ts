import {
  LayoutDashboard,
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
  KeyRound,
  ClipboardList,
  ClipboardCheck,
  HardHat,
  MessageCircle,
  Gauge,
  RefreshCw,
  ListChecks,
  Footprints,
  Banknote,
  CalendarDays,
  LayoutGrid,
  GraduationCap,
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
  { to: "/",            label: "Dashboard",   icon: LayoutDashboard, roles: ["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  // Work Orders V2 — now the primary facilities ticketing flow.
  // Sits at the top right under Dashboard so it's the first
  // operational tool field roles see.
  { to: "/admin/work-orders-v2", label: "Work Orders", icon: Hammer, roles: ["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/chat",        label: "Chat",        icon: MessageCircle,   roles: null },
  // Operations Tools — a card hub for the field/store-ops tools (Site Audits,
  // Walkthroughs, Reno Scoping). The individual tools keep their own routes;
  // this is the consolidated entry point.
  { to: "/operations",  label: "Operations Tools", icon: LayoutGrid, roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/ranker",      label: "Ranker",      icon: TrendingUp,      roles: ["do", "sdo", "rvp", "vp", "coo", "admin"] },
  // Labor — daily labor review. GMs review their store's numbers against
  // chart and explain misses; DO+ get the district rollup. Backend
  // (labor.js) enforces scope; nav is wide so shift managers see it too.
  { to: "/labor",       label: "Labor",       icon: Gauge,           roles: ["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  // Cash Management — night-close + next-day deposit cycle. Store leaders
  // run it; DO+ act on alerts. Rolled out by role now (the pilot flag was
  // retired once it shipped to all store leaders).
  { to: "/admin/cash-management", label: "Cash Management", icon: Banknote, roles: ["gm", "shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "do", "sdo", "rvp", "vp", "coo", "admin", "accounting"] },
  // Note: design-import preview routes (e.g. /region) are deliberately
  // NOT in the sidebar — they're placeholder UIs while real scoring +
  // workflows get built out, and they'd add noise to the daily nav.
  // Open them via direct URL until they're promoted.
  // Workspaces is a tabbed landing page that hosts the workspace list
  // plus the personal cross-workspace queues (My Assignments, Sign-off
  // Queue, My CAPs) as inner tabs. Wide role allowlist so submitters
  // can see their assignments; backend filters down by
  // workspace_members + scope-based visibility.
  //
  // The standalone routes /assignments, /signoffs, /caps still work
  // for deep links (e.g. from the AssignmentDetailPage back-link), but
  // they don't appear in the sidebar — open /workspaces and switch tabs.
  { to: "/workspaces",  label: "Workspaces",  icon: ClipboardList,   roles: ["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"] },
  // Reno Scoping — Pre-Reskin Scoping for the 2026 Full-to-Bright
  // program. GM+ can scope their own store; DO+ reviews. RLS filters
  // visibility regardless, but we gate the nav link to GM+ so shift
  // managers don't see a dead link.
  { to: "/reno-scoping", label: "Reno Scoping", icon: HardHat,        roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  // My Walks — the GM/assignee home for store walkthroughs (start/continue
  // assigned walks + recent submissions). Wide assignee allowlist.
  { to: "/my-walks",    label: "My Walks",    icon: Footprints,      roles: ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  // Walkthroughs hub (DO+) — Review / Assignments / Templates / Geofences as
  // tabs, so they don't sprawl across the sidebar. Geofences tab is admin-only.
  { to: "/walkthroughs", label: "Walkthroughs", icon: ListChecks,     roles: ["do", "sdo", "rvp", "vp", "coo", "admin"] },
  // Legacy Work Orders (Smartsheet-backed) — hidden from the sidebar
  // after the V2 cutover. Route stays alive for archival deep links;
  // admins can still navigate to /work-orders manually if needed.
  // { to: "/work-orders", label: "Work Orders", icon: Wrench, roles: ["admin"] },
  // PAF is currently in pilot mode — only payroll + admin by role. The
  // paf_pilot flag widens this to specific hand-picked testers (DOs,
  // RVPs, etc.) without code changes; admins add user IDs from
  // /admin/feature-flags. To return to the previous "DO and up" rule,
  // delete the flagKey here and add the original roles back to roles.
  { to: "/paf",         label: "PAF",         icon: FileSpreadsheet, roles: ["do", "payroll", "admin"], flagKey: "paf_pilot" },
  // Employee Actions — Training Credit + PTO request forms. GM and up;
  // submitting notifies the store's DO + RVP. Approvals/tracking land later.
  { to: "/employee-actions", label: "Employee Actions", icon: ClipboardCheck, roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  // Coaching Tool Kit — coaching-for-performance reference cards for hourly
  // managers and above. Lives under People.
  { to: "/coaching",    label: "Coaching Tool Kit", icon: GraduationCap, roles: ["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/schedule",    label: "Schedule",    icon: CalendarDays,    roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/contacts",    label: "Contacts",    icon: BookUser,        roles: null },
  { to: "/resources",   label: "Resources",   icon: BookOpen,        roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/team",        label: "My Team",     icon: Users,           roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"] },
  { to: "/my-stores",   label: "My Stores",   icon: Building2,       roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"] },
  { to: "/admin/org",   label: "Org Admin",   icon: Network,         roles: ["vp", "coo", "admin"] },
  { to: "/admin/bulk-attributes", label: "Bulk Attributes", icon: Layers, roles: ["admin"] },
  { to: "/admin/feature-flags",   label: "Feature Flags",   icon: Flag,   roles: ["admin"] },
  { to: "/admin/role-access",     label: "Role Access",     icon: KeyRound, roles: ["admin"] },
  { to: "/admin/paf-config", label: "PAF Config", icon: Settings,    roles: ["payroll", "admin"] },
  { to: "/admin/labor-sync", label: "Labor Sync", icon: RefreshCw,   roles: ["vp", "coo", "admin"] },
  { to: "/account",     label: "Account",     icon: UserCircle,      roles: null },
];

export function visibleNav(
  role: UserRole | undefined,
  flags: Record<string, boolean> = {},
  // Per-role module overrides from the Role Access page (keyed by item.to).
  // An explicit override wins both ways; otherwise the code defaults apply.
  overrides: Record<string, Partial<Record<UserRole, boolean>>> = {},
): NavItem[] {
  if (!role) return [];
  return NAV.filter((item) => {
    if (role === "admin") return true; // admin always sees everything
    const ov = overrides[item.to]?.[role];
    if (ov !== undefined) return ov;
    if (!item.roles) return true;
    if (item.roles.includes(role)) return true;
    if (item.flagKey && flags[item.flagKey]) return true;
    return false;
  });
}

// Map a pathname to the NAV module key it belongs to (the longest matching
// `to`), so route guards can apply the same per-role overrides as the nav.
// Returns null when the path isn't under a managed module.
export function moduleKeyForPath(pathname: string): string | null {
  const exact = NAV.find((n) => n.to === pathname);
  if (exact) return exact.to;
  let best: string | null = null;
  for (const n of NAV) {
    if (n.to === "/") continue; // root would prefix-match everything
    if (pathname === n.to || pathname.startsWith(n.to + "/")) {
      if (!best || n.to.length > best.length) best = n.to;
    }
  }
  return best;
}

// Where to land each role after sign-in. Payroll skips Dashboard
// (which they don't see anyway) and lands on the PAF queue.
export function defaultLandingPath(role: UserRole | undefined): string {
  if (role === "payroll") return "/paf/queue";
  return "/";
}

// ── Sidebar grouping ────────────────────────────────────────────────
// The redesigned sidebar buckets nav items into labelled sections. Order
// here is the render order; a path not listed falls into "Admin".
export const NAV_GROUP_ORDER = ["MAIN", "OPERATIONS", "PEOPLE", "WORKSPACE", "ADMIN"] as const;
export type NavGroup = (typeof NAV_GROUP_ORDER)[number];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  MAIN: "Main",
  OPERATIONS: "Operations",
  PEOPLE: "People",
  WORKSPACE: "Workspace",
  ADMIN: "Admin",
};

const GROUP_OF: Record<string, NavGroup> = {
  "/": "MAIN",
  "/admin/work-orders-v2": "MAIN",
  "/chat": "MAIN",
  "/operations": "OPERATIONS",
  "/ranker": "OPERATIONS",
  "/labor": "OPERATIONS",
  "/admin/cash-management": "OPERATIONS",
  "/reno-scoping": "OPERATIONS",
  "/schedule": "OPERATIONS",
  "/my-walks": "OPERATIONS",
  "/walkthroughs": "OPERATIONS",
  "/paf": "PEOPLE",
  "/employee-actions": "PEOPLE",
  "/coaching": "PEOPLE",
  "/contacts": "PEOPLE",
  "/team": "PEOPLE",
  "/resources": "WORKSPACE",
  "/my-stores": "WORKSPACE",
  "/account": "WORKSPACE",
  "/admin/org": "ADMIN",
  "/admin/bulk-attributes": "ADMIN",
  "/admin/feature-flags": "ADMIN",
  "/admin/role-access": "ADMIN",
  "/admin/paf-config": "ADMIN",
  "/admin/labor-sync": "ADMIN",
};

// Bucket already-filtered nav items into ordered, labelled groups. Empty
// groups are dropped so a role only sees the sections it has items in.
export function groupedNav(
  items: NavItem[],
): { group: NavGroup; label: string; items: NavItem[] }[] {
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    label: NAV_GROUP_LABELS[group],
    items: items.filter((it) => (GROUP_OF[it.to] ?? "ADMIN") === group),
  })).filter((section) => section.items.length > 0);
}
