// Bottom-tab navigation for the mobile shell. Four tabs covering the
// most common destinations (Home / Approvals / Stores / More) plus a
// More tab that opens the existing sidebar as a slide-in drawer so
// nothing in the existing nav becomes unreachable.
//
// Visible only below the lg breakpoint — desktop keeps the sidebar.

import { NavLink } from "react-router-dom";
import {
  Home,
  BadgeCheck,
  Store,
  Wrench,
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
  { to: "/",                     label: "Home",     Icon: Home,      endMatch: true },
  { to: "/admin/work-orders-v2", label: "Work",     Icon: Wrench },
  { to: "/approvals",            label: "Approvals", Icon: BadgeCheck },
  { to: "/region",               label: "Stores",   Icon: Store },
];

export function MobileTabBar({
  onMoreClick,
}: {
  onMoreClick: () => void;
}) {
  return (
    <nav
      className="shrink-0 border-t border-white/10 bg-midnight lg:hidden"
      style={{
        // Sit the bar close to the bottom edge like native tab bars:
        // pad by the home-indicator inset minus ~14px (so the labels
        // drop near the edge but still clear the indicator pill), with a
        // small floor for non-notched devices. The midnight bg still
        // paints the inset, so the bottom stays a cohesive navy frame.
        paddingBottom: "max(calc(env(safe-area-inset-bottom, 0px) - 14px), 6px)",
      }}
      aria-label="Primary"
    >
      <div className="grid grid-cols-5 max-w-md mx-auto">
        {MOBILE_TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.endMatch}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition",
                isActive
                  ? "text-white"
                  : "text-white/55 hover:text-white/85",
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
          className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-white/55 hover:text-white/85 transition"
          aria-label="Open full navigation"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
