// Cash Management hub — the "single roof" for the night-close → next-day
// deposit cycle. Tabbed like the Walkthroughs hub: Dashboard · Night Closeout
// · Deposit Validation · Discrepancy Alerts · DSR & Carried Over.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Bell, Home, Moon, TrendingUp, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchOverview } from "./api";
import { DashboardTab } from "./DashboardTab";
import { CloseoutTab } from "./CloseoutTab";
import { DepositTab } from "./DepositTab";
import { AlertsTab } from "./AlertsTab";
import { DsrTab } from "./DsrTab";

type TabId = "dashboard" | "closeout" | "deposit" | "alerts" | "dsr";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "closeout", label: "Night Closeout", icon: Moon },
  { id: "deposit", label: "Deposit Validation", icon: Banknote },
  { id: "alerts", label: "Discrepancy Alerts", icon: Bell },
  { id: "dsr", label: "DSR & Carried Over", icon: TrendingUp },
];

export function CashManagementHubPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [active, setActive] = useState<TabId>("dashboard");

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
      <div className="mb-5 flex flex-wrap gap-1 border-b border-zinc-200">
        {TABS.map((t) => {
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
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition",
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
    [active, overview]
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
      <PageHeader
        title="Cash Management"
        description="Night closeout, next-day deposit validation, and the DSR carried-over ledger."
        actions={
          stores.length > 1 ? (
            <select
              value={effectiveStoreId ?? ""}
              onChange={(e) => setStoreId(e.target.value)}
              className="rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.number}
                  {s.name ? ` — ${s.name}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-md bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
              #{overview.store.number}
              {overview.store.name ? ` · ${overview.store.name}` : ""}
            </div>
          )
        }
      />

      {tabNav}

      {active === "dashboard" && <DashboardTab overview={overview} onNav={goto} />}
      {active === "closeout" && <CloseoutTab storeId={effectiveStoreId} onDone={() => goto("deposit")} />}
      {active === "deposit" && <DepositTab storeId={effectiveStoreId} onDone={() => goto("dsr")} />}
      {active === "alerts" && <AlertsTab storeId={effectiveStoreId} />}
      {active === "dsr" && <DsrTab storeId={effectiveStoreId} />}
    </div>
  );
}
