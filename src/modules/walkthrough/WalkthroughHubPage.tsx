// Walkthroughs — DO/admin hub. Collapses the separate Review / Assignments /
// Templates / Geofences nav rows into one tabbed page (matches the Workspaces
// pattern). Each tab is role-gated: Geofences is admin-only, the rest DO+.
// My Walks stays a separate top-level entry — it's the GM's mobile home.
//
// The tools are rendered in their `embedded` mode (no inner PageHeader), so the
// standalone routes still work for deep links.

import { useState } from "react";
import { CalendarClock, ListChecks, MapPin, SearchCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/types/database";
import { ReviewDashboardPage } from "./review/ReviewDashboardPage";
import { AssignmentsPage } from "./assign/AssignmentsPage";
import { TemplatesListPage } from "./builder/TemplatesListPage";
import { AnalyticsPage } from "./analytics/AnalyticsPage";
import { StoreGeofencesPage } from "./storegeo/StoreGeofencesPage";

const DO_PLUS: UserRole[] = ["do", "sdo", "rvp", "vp", "coo", "admin"];

interface HubTab {
  id: string;
  label: string;
  icon: LucideIcon;
  roles: UserRole[];
  render: () => React.ReactNode;
}

const TABS: HubTab[] = [
  { id: "review", label: "Review", icon: SearchCheck, roles: DO_PLUS, render: () => <ReviewDashboardPage embedded /> },
  { id: "assignments", label: "Assignments", icon: CalendarClock, roles: DO_PLUS, render: () => <AssignmentsPage embedded /> },
  { id: "templates", label: "Templates", icon: ListChecks, roles: DO_PLUS, render: () => <TemplatesListPage embedded /> },
  { id: "analytics", label: "Analytics", icon: TrendingUp, roles: DO_PLUS, render: () => <AnalyticsPage embedded /> },
  { id: "geofences", label: "Geofences", icon: MapPin, roles: ["admin"], render: () => <StoreGeofencesPage embedded /> },
];

export function WalkthroughHubPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  const tabs = TABS.filter((t) => role === "admin" || (role && t.roles.includes(role)));
  const [active, setActive] = useState(tabs[0]?.id ?? "review");
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        title="Walkthroughs"
        description="Review submissions, assign walks, manage templates, and set store geofences."
      />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-zinc-200">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition",
                active === t.id
                  ? "border-accent text-midnight"
                  : "border-transparent text-zinc-500 hover:text-zinc-700",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {current?.render()}
    </div>
  );
}
