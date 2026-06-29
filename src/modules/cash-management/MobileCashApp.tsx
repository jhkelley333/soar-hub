// Cash Management — mobile/PWA shell. A full-screen app experience: compact
// header with a store switcher, the four working tabs as a bottom nav (Cash
// takes over the global bar — see AppShell), and a sticky action footer that
// the Closeout/Deposit screens portal their primary button into. Settings is
// intentionally desktop-only and excluded here.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Banknote, Bell, Building2, ChevronLeft, Moon, TrendingUp, Vault, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { fetchOverview } from "./api";
import { CloseoutTab } from "./CloseoutTab";
import { DepositTab } from "./DepositTab";
import { AlertsTab } from "./AlertsTab";
import { DsrTab } from "./DsrTab";
import { StoreFundsTab } from "./StoreFundsTab";

type TabId = "closeout" | "deposit" | "alerts" | "dsr" | "funds";

// DO and above see the bank-validation rollup (Store Funds) as a 5th tab on
// the mobile bar. Mirrors the desktop hub's LEADER_ROLES set.
const LEADER_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);

const STORE_TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "closeout", label: "Closeout", icon: Moon },
  { id: "deposit", label: "Deposit", icon: Banknote },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "dsr", label: "DSR", icon: TrendingUp },
];
const LEADER_TAB: { id: TabId; label: string; icon: LucideIcon } = {
  id: "funds", label: "Funds", icon: Vault,
};

function initialsOf(name: string | null | undefined): string {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function MobileCashApp() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [active, setActive] = useState<TabId>("closeout");
  const [actionEl, setActionEl] = useState<HTMLDivElement | null>(null);

  const ov = useQuery({ queryKey: ["cash-overview", storeId], queryFn: () => fetchOverview(storeId) });
  const overview = ov.data;
  const effId = storeId ?? overview?.active_store_id ?? null;
  const stores = overview?.stores ?? [];
  const openAlerts = overview?.open_alerts ?? 0;
  const hasPending = !!overview?.pending_deposit;
  const hasAction = active === "closeout" || active === "deposit";
  const isLeader = !!profile?.role && LEADER_ROLES.has(profile.role);
  const tabs = isLeader ? [...STORE_TABS, LEADER_TAB] : STORE_TABS;

  return (
    <div className="flex h-full flex-col bg-surface-muted">
      {/* compact top bar — back + store switcher + avatar */}
      <header className="shrink-0 border-b border-zinc-200 bg-white px-2 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => navigate("/")}
            aria-label="Back"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 active:bg-zinc-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1">
            <Building2 className="h-4 w-4 shrink-0 text-zinc-400" />
            {stores.length > 1 ? (
              <select
                value={effId ?? ""}
                onChange={(e) => setStoreId(e.target.value)}
                className="min-w-0 flex-1 truncate bg-transparent text-sm font-semibold text-midnight focus:outline-none"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.number}
                    {s.name ? ` · ${s.name}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="min-w-0 truncate text-sm font-semibold text-midnight">
                {overview?.store ? `#${overview.store.number}${overview.store.name ? ` · ${overview.store.name}` : ""}` : "Cash"}
              </div>
            )}
          </div>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-midnight text-[11px] font-semibold text-white">
            {initialsOf(profile?.full_name || profile?.email)}
          </span>
        </div>
      </header>

      {/* scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5" style={{ overscrollBehavior: "contain" }}>
        {active === "closeout" && <CloseoutTab storeId={effId} onDone={() => setActive("deposit")} actionSlot={actionEl} />}
        {active === "deposit" && <DepositTab storeId={effId} onDone={() => setActive("dsr")} actionSlot={actionEl} />}
        {active === "alerts" && <AlertsTab storeId={effId} />}
        {active === "dsr" && <DsrTab storeId={effId} />}
        {active === "funds" && isLeader && <StoreFundsTab />}
      </div>

      {/* sticky primary action — Closeout/Deposit portal their button here */}
      {hasAction && <div ref={setActionEl} className="shrink-0 border-t border-zinc-200 bg-white px-4 py-3" />}

      {/* bottom tab bar (Cash takes over the global bar on this route) */}
      <nav
        className="shrink-0 border-t border-zinc-200 bg-white"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) / 2)" }}
        aria-label="Cash sections"
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((t) => {
            const on = active === t.id;
            const badge = t.id === "alerts" ? openAlerts : t.id === "deposit" && hasPending ? 1 : 0;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={cn(
                  "flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium transition",
                  on ? "text-accent" : "text-zinc-500"
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={on ? 2.25 : 1.75} />
                  {badge > 0 && (
                    <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-cherry px-1 text-[9px] font-semibold leading-none text-white">
                      {badge}
                    </span>
                  )}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
