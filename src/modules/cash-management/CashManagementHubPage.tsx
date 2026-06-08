// Cash Management hub — the "single roof" for the night-close → next-day
// deposit cycle. Tabbed like the Walkthroughs hub: Dashboard · Night Closeout
// · Deposit Validation · Discrepancy Alerts · DSR & Carried Over.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Bell, HelpCircle, Home, LayoutGrid, Moon, Settings, TrendingUp, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchOverview } from "./api";
import { DashboardTab } from "./DashboardTab";
import { LeaderDashboardTab } from "./LeaderDashboardTab";
import { CloseoutTab } from "./CloseoutTab";
import { DepositTab } from "./DepositTab";
import { AlertsTab } from "./AlertsTab";
import { DsrTab } from "./DsrTab";
import { SettingsTab } from "./SettingsTab";
import { CashGuideDrawer } from "./CashGuideDrawer";

type TabId = "leaders" | "dashboard" | "closeout" | "deposit" | "alerts" | "dsr" | "settings";

// DO/SDO/RVP/VP/COO/admin get the multi-store leader roll-up (mirrors the
// server's ACT_ROLES gate on ?action=leader-overview).
const LEADER_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);

const LEADER_TAB: { id: TabId; label: string; icon: LucideIcon } = {
  id: "leaders",
  label: "Leaders",
  icon: LayoutGrid,
};
const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "closeout", label: "Night Closeout", icon: Moon },
  { id: "deposit", label: "Deposit Validation", icon: Banknote },
  { id: "alerts", label: "Discrepancy Alerts", icon: Bell },
  { id: "dsr", label: "DSR & Carried Over", icon: TrendingUp },
];
const SETTINGS_TAB: { id: TabId; label: string; icon: LucideIcon } = {
  id: "settings",
  label: "Settings",
  icon: Settings,
};

export function CashManagementHubPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const isLeader = !!profile?.role && LEADER_ROLES.has(profile.role);
  const [storeId, setStoreId] = useState<string | null>(null);
  // Leaders land on the roll-up; everyone else on their store dashboard.
  const [active, setActive] = useState<TabId>(isLeader ? "leaders" : "dashboard");
  const [guideOpen, setGuideOpen] = useState(false);

  // Drill from a leader-roll-up row into that store's dashboard.
  const openStore = (id: string) => {
    setStoreId(id);
    setActive("dashboard");
  };

  const overviewQuery = useQuery({
    queryKey: ["cash-overview", storeId],
    queryFn: () => fetchOverview(storeId),
  });

  const overview = overviewQuery.data;
  const effectiveStoreId = storeId ?? overview?.active_store_id ?? null;
  const stores = overview?.stores ?? [];

  const goto = (tab: TabId) => setActive(tab);

  const tabNav = useMemo(
    () => (
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
        {[
          ...(isLeader ? [LEADER_TAB] : []),
          ...TABS,
          ...(isAdmin ? [SETTINGS_TAB] : []),
        ].map((t) => {
          const Icon = t.icon;
          const badge =
            t.id === "deposit" && overview?.pending_deposit
              ? 1
              : t.id === "alerts" && overview?.open_alerts
                ? overview.open_alerts
                : 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition sm:py-2",
                active === t.id ? "border-accent text-midnight" : "border-transparent text-zinc-500 hover:text-zinc-700"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {badge > 0 && (
                <span
                  className={cn(
                    "ml-0.5 inline-grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white",
                    t.id === "alerts" ? "bg-red-500" : "bg-amber-500"
                  )}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    ),
    [active, overview, isAdmin, isLeader]
  );

  if (overviewQuery.isLoading) {
    return (
      <div className="mx-auto max-w-[1120px]">
        <PageHeader title="Cash Management" description="Hub Operations" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (overviewQuery.isError || !overview) {
    return (
      <div className="mx-auto max-w-[1120px]">
        <PageHeader title="Cash Management" />
        <EmptyState
          title="Couldn't load Cash Management"
          description={(overviewQuery.error as Error)?.message ?? "Make sure migration 0129 has run."}
        />
      </div>
    );
  }

  if (!overview.store) {
    return (
      <div className="mx-auto max-w-[1120px]">
        <PageHeader title="Cash Management" description="Hub Operations" />
        <EmptyState title="No store in your scope" description="Cash Management is scoped to the stores you manage." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1120px]">
      {/* Responsive header: stacks on mobile so a long store name can't push
          the page wider than the viewport (which caused horizontal panning). */}
      <header className="mb-7 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-midnight">Cash Management</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Night closeout, next-day deposit validation, and the DSR carried-over ledger.
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setGuideOpen(true)} className="shrink-0">
            <HelpCircle className="h-4 w-4" /> Guide
          </Button>
          {stores.length > 1 ? (
            <select
              value={effectiveStoreId ?? ""}
              onChange={(e) => setStoreId(e.target.value)}
              className="min-w-0 flex-1 truncate rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent sm:flex-none"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.number}
                  {s.name ? ` — ${s.name}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="min-w-0 flex-1 truncate rounded-md bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 sm:flex-none">
              #{overview.store.number}
              {overview.store.name ? ` · ${overview.store.name}` : ""}
            </div>
          )}
        </div>
      </header>

      {tabNav}

      {active === "leaders" && isLeader && <LeaderDashboardTab onOpenStore={openStore} />}
      {active === "dashboard" && <DashboardTab overview={overview} onNav={goto} />}
      {active === "closeout" && <CloseoutTab storeId={effectiveStoreId} onDone={() => goto("deposit")} />}
      {active === "deposit" && <DepositTab storeId={effectiveStoreId} onDone={() => goto("dsr")} />}
      {active === "alerts" && <AlertsTab storeId={effectiveStoreId} />}
      {active === "dsr" && <DsrTab storeId={effectiveStoreId} />}
      {active === "settings" && isAdmin && <SettingsTab />}

      <CashGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
