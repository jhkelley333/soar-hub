// Bottom-tab navigation for the mobile shell. Four tabs covering the
// most common destinations (Home / Approvals / Stores / More) plus a
// More tab that opens the existing sidebar as a slide-in drawer so
// nothing in the existing nav becomes unreachable.
//
// Visible only below the lg breakpoint — desktop keeps the sidebar.

import { NavLink } from "react-router-dom";
import {
  Home,
  MessageCircle,
  BookUser,
  Wrench,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useChatUnreadCount } from "@/modules/chat/useChatUnread";

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
  { to: "/",                     label: "Home",      Icon: Home,      endMatch: true },
  { to: "/admin/work-orders-v2", label: "Work",      Icon: Wrench },
  { to: "/chat",                 label: "Chat",      Icon: MessageCircle },
  { to: "/directory",            label: "Directory", Icon: BookUser },
];

export function MobileTabBar({
  onMoreClick,
}: {
  onMoreClick: () => void;
}) {
  const chatUnread = useChatUnreadCount();
  return (
    <nav
      className="shrink-0 border-t border-white/10 bg-midnight lg:hidden"
      style={{
        // Anchor the bar low against the bottom edge, native tab-bar
        // style. We pad only a quarter of the home-indicator inset so the
        // labels sit just above the gesture area without floating up off
        // the edge. (An earlier "+8px lift" pushed the whole bar upward;
        // dropped here to bring it back into the normal native range.)
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) / 4)",
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
                "flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 text-[10px] font-medium transition",
                isActive
                  ? "text-white"
                  : "text-white/55 hover:text-white/85",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <t.Icon
                    className="h-5 w-5"
                    strokeWidth={isActive ? 2.25 : 1.75}
                  />
                  {t.to === "/chat" && chatUnread > 0 && (
                    <span
                      className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cherry px-1 text-[9px] font-semibold leading-none text-white"
                      aria-label={`${chatUnread} unread`}
                    >
                      {chatUnread > 99 ? "99+" : chatUnread}
                    </span>
                  )}
                </span>
                <span>{t.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMoreClick}
          className="flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 text-[10px] font-medium text-white/55 hover:text-white/85 transition"
          aria-label="Open full navigation"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
