// Bottom-tab navigation for the mobile shell. Four tabs covering the
// most common destinations (Home / Approvals / Stores / More) plus a
// More tab that opens the existing sidebar as a slide-in drawer so
// nothing in the existing nav becomes unreachable.
//
// Visible only below the lg breakpoint — desktop keeps the sidebar.

import { NavLink } from "react-router-dom";
import {
  Home,
  Inbox,
  Building2,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

export interface MobileTab {
  to: string;
  label: string;
  Icon: LucideIcon;
  /** Whether the active state matches the URL with `end` (only exact)
   *  or as a prefix. Most tabs match prefixes so a child route
   *  ("/region/store/123") still highlights the parent tab. */
  endMatch?: boolean;
}

export const MOBILE_TABS: MobileTab[] = [
  { to: "/",          label: "Home",      Icon: Home,       endMatch: true },
  { to: "/approvals", label: "Approvals", Icon: Inbox },
  { to: "/region",    label: "Stores",    Icon: Building2 },
];

export function MobileTabBar({
  onMoreClick,
}: {
  onMoreClick: () => void;
}) {
  return (
    <nav
      className="shrink-0 border-t border-midnight-100 bg-white/95 backdrop-blur lg:hidden"
      style={{
        // Padding-bottom carries the iPhone home-indicator inset so
        // the buttons sit above the gesture bar. The nav itself is a
        // regular flex row in AppShell — no fixed positioning — so
        // content can't scroll past it.
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      aria-label="Primary"
    >
      <div className="grid grid-cols-4 max-w-md mx-auto">
        {MOBILE_TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.endMatch}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition",
                isActive
                  ? "text-midnight-900"
                  : "text-midnight-400 hover:text-midnight-700",
              )
            }
          >
            {({ isActive }) => (
              <>
                <t.Icon
                  className="h-5 w-5"
                  strokeWidth={isActive ? 2.25 : 1.75}
                />
                <span>{t.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMoreClick}
          className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-midnight-400 hover:text-midnight-700 transition"
          aria-label="Open full navigation"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
