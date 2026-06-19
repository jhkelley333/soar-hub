import { useState } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { RollerGame } from "@/auth/RollerGame";
import { groupedNav, visibleNav } from "@/app/nav";
import { fetchResolvedFlags } from "@/lib/flags";
import { useOverrides } from "@/lib/roleAccess";
import { useRegionAccess, regionVisible } from "@/lib/regionAccess";
import { listPafs, listSdoQueue } from "@/modules/paf/api";
import { listApprovalQueue } from "@/modules/employee-actions/api";
import { countPendingScopes } from "@/modules/reno-scoping/api";
import { useChatUnreadCount } from "@/modules/chat/useChatUnread";
import { ROLE_LABELS, roleLevel, type UserRole } from "@/types/database";
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

// Count of submitted-but-not-yet-reviewed reno scopes visible to the
// caller. RLS filters automatically — DOs see their district, RVPs see
// their region, etc. Shown next to the Reno Scoping nav item for any
// reviewer role (DO+).
function useRenoBadgeCount(role: UserRole | undefined): number | null {
  const level = role ? roleLevel(role) : null;
  const isReviewer = level != null && level >= roleLevel("do")!;
  const q = useQuery({
    queryKey: ["reno-pending-count"],
    queryFn: countPendingScopes,
    enabled: isReviewer,
    staleTime: 30_000,
  });
  if (!isReviewer) return null;
  return q.data ?? null;
}

// Count of Employee Action requests awaiting the caller's action (approvals
// plus the post-approval confirmations — entered / closeout / PAF). The
// endpoint already filters to "needs my action" and scopes by role, so the
// badge is just the queue size. Reuses the ["ea-queue"] cache shared with the
// Approvals tab. Submitters who aren't approvers get no badge.
const EA_BADGE_ROLES = new Set<UserRole>(["do", "sdo", "rvp", "admin"]);

function useEmployeeActionsBadgeCount(role: UserRole | undefined): number | null {
  const isApprover = role !== undefined && EA_BADGE_ROLES.has(role);
  const q = useQuery({
    queryKey: ["ea-queue"],
    queryFn: listApprovalQueue,
    enabled: isApprover,
    staleTime: 30_000,
  });
  if (!isApprover || !q.data) return null;
  return q.data.trainingCredits.length + q.data.ptoRequests.length;
}

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase() || first.toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

// The sidebar is the app's brand chrome — a deep midnight gradient in BOTH
// light and dark themes (only the main content area flips). So it's styled
// with fixed dark-on-navy colors rather than `dark:` variants.
export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { profile, signOut } = useAuth();
  // Hidden easter egg — tapping the red brand mark opens RollerBuddy's runner.
  const [gameOpen, setGameOpen] = useState(false);
  // Reuses the same query key as useFlag() so we don't double-fetch.
  const flagsQ = useQuery({
    queryKey: ["feature-flags"],
    queryFn: fetchResolvedFlags,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { overrides } = useOverrides();
  const { overrides: regionOverrides, myRegionIds } = useRegionAccess();
  const navItems = visibleNav(profile?.role, flagsQ.data?.flags, overrides).filter(
    (item) => profile?.role === "admin" || regionVisible(item.to, myRegionIds, regionOverrides),
  );
  const sections = groupedNav(navItems);
  const pafBadge = usePafBadgeCount(profile?.role);
  const eaBadge = useEmployeeActionsBadgeCount(profile?.role);
  const renoBadge = useRenoBadgeCount(profile?.role);
  const chatBadge = useChatUnreadCount();

  function badgeFor(to: string): number | null {
    if (to === "/paf" && typeof pafBadge === "number" && pafBadge > 0) return pafBadge;
    if (to === "/employee-actions" && typeof eaBadge === "number" && eaBadge > 0) return eaBadge;
    if (to === "/reno-scoping" && typeof renoBadge === "number" && renoBadge > 0) return renoBadge;
    if (to === "/chat" && chatBadge > 0) return chatBadge > 99 ? 99 : chatBadge;
    return null;
  }

  return (
    <>
    <aside
      className="flex h-full w-64 flex-col text-white shadow-xl lg:shadow-none"
      style={{ background: "linear-gradient(180deg, #1C3D5C 0%, #15324B 100%)" }}
    >
      {/* Brand — the red mark is a secret button: tap it to play. */}
      <div className="flex h-16 items-center gap-3 px-5">
        <button
          type="button"
          onClick={() => setGameOpen(true)}
          aria-label="Play"
          title="Psst… tap to play"
          className="h-9 w-9 shrink-0 rounded-full ring-1 ring-white/15 transition hover:scale-105 hover:ring-frost/60 active:scale-95"
        >
          <img src="/app-icon.png" alt="" className="h-full w-full rounded-full object-cover" />
        </button>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight tracking-tight">SOAR Hub</div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-frost/70">
            Sonic Operations
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.group} className="mt-4 first:mt-1">
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const badge = badgeFor(item.to);
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      onClick={() => onNavigate?.()}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
                          isActive
                            ? "bg-accent text-white shadow-sm"
                            : "text-white/70 hover:bg-white/10 hover:text-white",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                          <span className="flex-1 truncate">{item.label}</span>
                          {badge !== null && (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                                isActive ? "bg-white/20 text-white" : "bg-cherry text-white",
                              )}
                              aria-label={`${badge} item${badge === 1 ? "" : "s"} awaiting action`}
                            >
                              {badge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5">
          {profile && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/90 text-xs font-semibold text-white">
              {initialsOf(profile.full_name, profile.email)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">
              {profile?.full_name ?? profile?.email}
            </div>
            {profile && (
              <div className="truncate text-xs text-white/50">{ROLE_LABELS[profile.role]}</div>
            )}
          </div>
          <button
            onClick={() => void signOut()}
            aria-label="Sign out"
            title="Sign out"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
    {gameOpen && createPortal(<RollerGame onClose={() => setGameOpen(false)} />, document.body)}
    </>
  );
}
