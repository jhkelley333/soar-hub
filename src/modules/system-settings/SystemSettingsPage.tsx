// System Settings — an Admin hub that gathers the scattered admin/config tools
// behind one sidebar entry, grouped by purpose. Mirrors Operations Tools: a
// card grid, role-filtered, one link per tool. Individual tools keep their own
// routes; this is just a launcher.

import { Link } from "react-router-dom";
import {
  ArrowRight, Network, Users, MapPin, KeyRound, Globe, Flag, QrCode, Link2,
  CloudSun, BarChart3, LayoutGrid, Gauge, ScrollText, Layers, Upload,
  Settings, ClipboardCheck, ListChecks, BookMarked, Clock, AlarmClock, TrendingDown, Building2,
  Fingerprint, Send, Info, MapPinned, Sparkles, GraduationCap, Plane, Activity, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/shared/ui/PageHeader";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/types/database";

interface Tool {
  title: string;
  desc: string;
  icon: LucideIcon;
  roles: UserRole[];
  to: string;
}
interface Group {
  title: string;
  tools: Tool[];
}

const GROUPS: Group[] = [
  {
    title: "Org Tools",
    tools: [
      { title: "Org Admin", desc: "Regions, areas, districts and stores — the whole org tree.", icon: Network, roles: ["vp", "coo", "admin"], to: "/admin/org" },
      { title: "GM Roster", desc: "GM assignments across every store — SDO/RVP edit their own stores' names.", icon: Users, roles: ["sdo", "rvp", "vp", "coo", "admin"], to: "/admin/gm-roster" },
      { title: "Store Geofences", desc: "Each store's geofence radius for on-site checks.", icon: MapPin, roles: ["admin"], to: "/admin/store-geofences" },
      { title: "Hours of Operation", desc: "Standard + special hours, Google compare, and discrepancy reconciliation.", icon: Clock, roles: ["sdo", "rvp", "vp", "coo", "admin"], to: "/admin/hours-of-operation" },
      { title: "Close-Time Watch", desc: "Stores whose last clock-out was before their scheduled close — daily, weekly, monthly.", icon: AlarmClock, roles: ["sdo", "rvp", "vp", "coo", "admin"], to: "/admin/close-time-watch" },
      { title: "Territory Map", desc: "Every store plotted on the map, pin color keyed to its DO.", icon: MapPinned, roles: ["vp", "coo", "admin"], to: "/territory-map" },
      { title: "Org Alignment", desc: "Stage a market realignment — new regions/areas/districts + store moves — and schedule it to go live on a date.", icon: Network, roles: ["admin"], to: "/admin/org-alignment" },
    ],
  },
  {
    title: "Intelligence Trait & Learning",
    tools: [
      { title: "Intelligence Trait", desc: "The trait framework and all 21 patterns — adapted from Culture Index.", icon: Fingerprint, roles: ["vp", "coo", "admin"], to: "/culture-index" },
      { title: "Team Playbook", desc: "AI coaching on leading your team, grounded in each person's traits.", icon: Sparkles, roles: ["vp", "coo", "admin"], to: "/culture-index/playbook" },
      { title: "Trait Analytics", desc: "Org-wide trait × performance × store-stability analytics.", icon: BarChart3, roles: ["vp", "coo", "admin"], to: "/culture-index/overview" },
      { title: "Soar MyLearning", desc: "The SOAR QSR learning platform.", icon: GraduationCap, roles: ["admin"], to: "/qsr" },
    ],
  },
  {
    title: "Accessibility",
    tools: [
      { title: "User Activity", desc: "Who's active now, last login per user, and a feed of recent actions.", icon: Activity, roles: ["admin", "coo", "vp"], to: "/admin/user-activity" },
      { title: "Role Access", desc: "What each role can see and do.", icon: KeyRound, roles: ["admin"], to: "/admin/role-access" },
      { title: "Region Access", desc: "Per-region access grants.", icon: Globe, roles: ["admin"], to: "/admin/region-access" },
      { title: "Feature Flags", desc: "Toggle features on or off per environment.", icon: Flag, roles: ["admin"], to: "/admin/feature-flags" },
      { title: "Reports", desc: "Scheduled + event report engine — recipients, schedules, run history.", icon: Send, roles: ["admin"], to: "/admin/reports" },
      { title: "Metric Definitions", desc: "Plain-language explanations behind the ⓘ info tooltips.", icon: Info, roles: ["admin"], to: "/admin/definitions" },
      { title: "Command Center Links", desc: "Per-store command-center links and QR codes.", icon: QrCode, roles: ["admin"], to: "/admin/store-portal" },
      { title: "Stay-Logged-In Links", desc: "Mint durable token-in-URL logins for the field.", icon: Link2, roles: ["vp", "coo", "admin"], to: "/admin/access-links" },
    ],
  },
  {
    title: "Back Up Syncs",
    tools: [
      { title: "Weather Sync", desc: "Refresh weather data on demand.", icon: CloudSun, roles: ["admin"], to: "/admin/weather-sync" },
    ],
  },
  {
    title: "Beta Test",
    tools: [
      { title: "KPI Dashboard", desc: "Execution KPI dashboard (in beta).", icon: BarChart3, roles: ["admin"], to: "/admin/kpi" },
      { title: "Metrics Board", desc: "Execution metrics board (in beta).", icon: LayoutGrid, roles: ["do", "sdo", "rvp", "vp", "coo", "admin"], to: "/admin/metrics-board" },
      { title: "Store Visit", desc: "Mobile-first store walk + Top-3 gaps (in beta).", icon: ClipboardCheck, roles: ["do", "sdo", "rvp", "vp", "coo", "admin"], to: "/visit" },
      { title: "Bottom Performers", desc: "Bottom GMs + DO per SDO by this year's ranker trend.", icon: TrendingDown, roles: ["sdo", "rvp", "vp", "coo", "admin"], to: "/admin/ranking/bottom-performers" },
      { title: "Cancun Convention", desc: "CMG Cancun Convention 2026 attendee app (in beta) — guide, checklist, dining, agenda, gated support.", icon: Plane, roles: ["admin"], to: "/cancun" },
    ],
  },
  {
    title: "Data & Imports",
    tools: [
      { title: "Labor Rollup", desc: "Labor v2 rollup and weekly snapshots.", icon: Gauge, roles: ["admin"], to: "/admin/labor-v2" },
      { title: "Pull Log", desc: "KPI / labor feed pull history.", icon: ScrollText, roles: ["admin"], to: "/admin/labor-v2/log" },
      { title: "Bulk Attributes", desc: "Bulk-edit store attributes.", icon: Layers, roles: ["admin"], to: "/admin/bulk-attributes" },
      { title: "Bulk User Import", desc: "Invite or update team members from a CSV.", icon: Upload, roles: ["admin"], to: "/admin/bulk-import" },
      { title: "Bulk Org Import", desc: "Import or update the org tree from a CSV.", icon: Upload, roles: ["admin"], to: "/admin/bulk-org-import" },
      { title: "Cultural Index Import", desc: "Tie Culture Index traits to profiles from the survey CSV — confirms close names.", icon: Fingerprint, roles: ["admin"], to: "/admin/cultural-index-import" },
      { title: "Ranker History Backfill", desc: "Migrate v1 sheet + v2 database ranker weeks into one table for cross-week analysis.", icon: Gauge, roles: ["admin"], to: "/admin/ranker-backfill" },
      { title: "Acquisitions", desc: "Stage an upcoming acquisition's stores, then merge them live across the hub.", icon: Building2, roles: ["vp", "coo", "admin"], to: "/admin/acquisitions" },
    ],
  },
  {
    title: "Templates & Config",
    tools: [
      { title: "PAF Config", desc: "Payroll Adjustment Form categories and fields.", icon: Settings, roles: ["payroll", "admin"], to: "/admin/paf-config" },
      { title: "Labor Settings", desc: "Hrs/Store calculation — per-week rate vs. full period total.", icon: Gauge, roles: ["admin"], to: "/admin/labor-settings" },
      { title: "Assessment Templates", desc: "New-leader assessment templates.", icon: ClipboardCheck, roles: ["admin"], to: "/admin/nla-templates" },
      { title: "Walkthrough Templates", desc: "Store walkthrough templates.", icon: ListChecks, roles: ["do", "sdo", "rvp", "vp", "coo", "admin"], to: "/admin/walkthrough-templates" },
      { title: "Manuals Admin", desc: "Manage manual documents and search.", icon: BookMarked, roles: ["rvp", "vp", "coo", "admin"], to: "/admin/manuals" },
    ],
  },
];

export function SystemSettingsPage() {
  const { profile } = useAuth();
  const role = profile?.role as UserRole | undefined;
  const groups = role
    ? GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => t.roles.includes(role)) }))
        .filter((g) => g.tools.length > 0)
    : [];

  return (
    <>
      <PageHeader
        title="System Settings"
        description="Admin and configuration tools in one place, grouped by purpose."
      />

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-muted dark:text-night-muted">
              {g.title}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.tools.map((t) => {
                const Icon = t.icon;
                return (
                  <Link
                    key={t.to}
                    to={t.to}
                    className={cn(
                      "group block rounded-2xl border p-5 text-left transition",
                      "border-zinc-200 bg-white shadow-card hover:border-accent/60 hover:shadow-float dark:border-night-line dark:bg-night-raised",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                        <Icon className="h-5 w-5" strokeWidth={1.75} />
                      </span>
                      <ArrowRight className="h-4 w-4 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-accent" strokeWidth={2} />
                    </div>
                    <div className="mt-4 text-base font-semibold tracking-tight text-ink dark:text-night-ink">{t.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted dark:text-night-muted">{t.desc}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
