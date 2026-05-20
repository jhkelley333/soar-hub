import { NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { visibleNav } from "@/app/nav";
import { fetchResolvedFlags } from "@/lib/flags";
import { listPafs, listSdoQueue } from "@/modules/paf/api";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { cn } from "@/lib/cn";

// Roles that see a PAF count badge in the sidebar. Submitters (DO,
// admin acting as submitter) don't get a badge — there's no "needs my
// action" semantic for them. Payroll/admin see Pending count; SDO/RVP/
// VP/COO see their bonus-approval queue count.
const PAYROLL_BADGE_ROLES = new Set<UserRole>(["payroll", "admin"]);
const SDO_BADGE_ROLES = new Set<UserRole>(["sdo", "rvp", "vp", "coo"]);

function usePafBadgeCount(role: UserRole | undefined): number | null {
  const isPayroll = role !== undefined && PAYROLL_BADGE_ROLES.has(role);
  const isSdo = role !== undefined && SDO_BADGE_ROLES.has(role);

  // Both queries are cached and shared with the rest of the PAF UI; the
  // sidebar just observes them.
  const pafQuery = useQuery({
    queryKey: ["paf-list"],
    queryFn: listPafs,
    enabled: isPayroll,
    staleTime: 30_000,
  });
  const sdoQuery = useQuery({
    queryKey: ["paf-sdo-queue"],
    queryFn: listSdoQueue,
    enabled: isSdo,
    staleTime: 30_000,
  });

  if (isPayroll) {
    if (!pafQuery.data) return null;
    return pafQuery.data.pafs.filter(
      (p) =>
        p.status === "Pending" ||
        p.status === "Approved" ||
        p.status === "Needs Approval"
    ).length;
  }
  if (isSdo) {
    if (!sdoQuery.data) return null;
    return sdoQuery.data.pafs.length;
  }
  return null;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { profile, signOut } = useAuth();
  // Reuses the same query key as useFlag() so we don't double-fetch.
  const flagsQ = useQuery({
    queryKey: ["feature-flags"],
    queryFn: fetchResolvedFlags,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const items = visibleNav(profile?.role, flagsQ.data?.flags);
  const pafBadge = usePafBadgeCount(profile?.role);

  return (
    <aside className="flex h-full w-60 flex-col border-r border-zinc-200 bg-white shadow-xl lg:shadow-none">
      <div className="flex h-14 items-center gap-2.5 border-b border-zinc-100 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-midnight text-xs font-semibold text-white">
          S
        </div>
        <div className="text-sm font-semibold tracking-tight text-midnight">SOAR Hub</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {items.map((item) => {
            const showBadge = item.to === "/paf" && typeof pafBadge === "number" && pafBadge > 0;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => onNavigate?.()}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition",
                      isActive
                        ? "bg-accent text-accent-fg"
                        : "text-zinc-600 hover:bg-zinc-50 hover:text-midnight"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className="h-4 w-4" strokeWidth={1.75} />
                      <span className="flex-1">{item.label}</span>
                      {showBadge && (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                            isActive
                              ? "bg-white/20 text-white"
                              : "bg-cherry text-white"
                          )}
                          aria-label={`${pafBadge} item${pafBadge === 1 ? "" : "s"} awaiting action`}
                        >
                          {pafBadge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-zinc-100 p-3">
        {profile && (
          <div className="mb-2 px-2.5 py-1.5">
            <div className="truncate text-sm font-medium text-zinc-900">
              {profile.full_name ?? profile.email}
            </div>
            <div className="text-xs text-zinc-500">{ROLE_LABELS[profile.role]}</div>
          </div>
        )}
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-midnight"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
