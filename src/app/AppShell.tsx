// AppShell — chrome around the authenticated app. Responsive:
//
//   lg+   — sidebar nav on the left, max-w-7xl content container. Same
//           as before. The mobile-only chrome elements collapse to
//           display:none and contribute no layout space.
//   < lg  — three stacked rows:
//             1. midnight brand strip that owns the iOS status-bar
//                safe-area zone. The system clock + signal icons sit
//                ON this strip in white (status-bar-style is
//                black-translucent in index.html).
//             2. main scroll area — flex-1, the ONLY scrollable
//                element in the shell.
//             3. MobileTabBar — a real flex item, NOT position:fixed.
//                Content in the scroll area can never underrun it
//                because the layout doesn't let it. Its own
//                padding-bottom carries the home-indicator inset.
//           Sidebar opens as a left drawer when "More" is tapped.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/app/Sidebar";
import { Topbar } from "@/app/Topbar";
import { MobileTabBar } from "@/app/MobileTabBar";
import { PushPrimer } from "@/app/PushPrimer";
import { InstallPrimer, useInstallPrompt } from "@/app/InstallPrimer";
import { useIdleLogout } from "@/auth/useIdleLogout";
import { useChatRealtime } from "@/modules/chat/useChatRealtime";
import { useAppBadge } from "@/modules/chat/useAppBadge";
import { useAuth } from "@/auth/AuthProvider";
import { LaunchSplash } from "@/auth/LaunchSplash";
import { RequiredTrainingPrompt } from "@/modules/qsr/RequiredTrainingPrompt";
import { ViewAsBanner } from "@/app/ViewAsBanner";
import { fetchMyTree, launchScopeLabel, scopeWordForRole } from "@/modules/my-stores/api";
import { cn } from "@/lib/cn";

// Personalized launch splash shown on the first authenticated load of a
// session, then faded into the home. Guarded by sessionStorage so it
// doesn't replay on every in-session reload / re-mount.
function useLaunchSplash() {
  const [active, setActive] = useState(
    () => !sessionStorage.getItem("soar_launch_shown"),
  );
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!active) return;
    sessionStorage.setItem("soar_launch_shown", "1");
    const fade = window.setTimeout(() => setFading(true), 2200);
    const done = window.setTimeout(() => setActive(false), 2800);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [active]);
  return { active, fading };
}

function greetingFor(name: string | null | undefined) {
  const hour = new Date().getHours();
  const part =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (name || "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

export function AppShell() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { profile } = useAuth();
  const splash = useLaunchSplash();
  // Home-screen install nudge. Takes the bottom-card slot ahead of the
  // push primer so the two never stack; push falls through once install
  // is handled (or when there's nothing to install).
  const install = useInstallPrompt();
  // Chat + Cash Management run full-bleed (each owns its own layout — Cash so
  // the mobile shell can manage its header/bottom-nav/scroll); every other
  // route keeps the padded, max-width container.
  const pathname = useLocation().pathname;
  const isCash = pathname.startsWith("/admin/cash-management");
  const fullBleed = pathname.startsWith("/chat") || isCash;
  // 2-hour idle auto-logout. Only active while a session exists (the
  // hook bails internally otherwise).
  useIdleLogout();
  // App-wide chat realtime so the unread badge updates live anywhere in the
  // app (not just on the chat screens).
  useChatRealtime();
  // Mirror the unread total onto the installed-PWA app-icon badge.
  useAppBadge();

  // Personalized splash subline: name the caller's scope + store count.
  // Shares the ["my-stores-tree"] cache the home/region views use, so
  // this is usually a no-op fetch after the first cold start.
  const role = profile?.role;
  const treeQ = useQuery({
    queryKey: ["my-stores-tree"],
    queryFn: fetchMyTree,
    enabled: splash.active && !!role,
    staleTime: 5 * 60_000,
  });
  const scopeLabel = treeQ.data && role ? launchScopeLabel(treeQ.data, role) : null;
  const splashSubline = !role
    ? "Loading…"
    : scopeLabel
      ? `Loading ${scopeLabel}`
      : `Loading your ${scopeWordForRole(role)}…`;

  return (
    <div className="flex h-dvh flex-col bg-canvas dark:bg-night">
      <RequiredTrainingPrompt />
      <ViewAsBanner />
      {/* Mobile-only status-bar backdrop. Height equals the iPhone's
          safe-area-inset-top (notch / Dynamic Island), so the system
          status bar paints on a midnight brand strip instead of on
          page content. Desktop hides it. */}
      <div
        aria-hidden
        className="shrink-0 bg-midnight lg:hidden"
        style={{ height: "env(safe-area-inset-top, 0px)" }}
      />

      {/* Body row: sidebar (desktop) + main scroll area. min-h-0 is the
          flex-child trick that lets the inner overflow-y-auto actually
          scroll instead of expanding the parent. */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar — always visible on lg+. */}
        <div className="hidden lg:flex">
          <Sidebar />
        </div>

        {/* Sidebar drawer — mobile only when "More" is tapped. */}
        {moreOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-zinc-900/40 lg:hidden"
              onClick={() => setMoreOpen(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
              <Sidebar onNavigate={() => setMoreOpen(false)} />
            </div>
          </>
        )}

        <main
          className="min-w-0 flex-1 overflow-y-auto"
          // Contain the rubber-band so a pull past the top/bottom of
          // the content doesn't drag the AppShell's midnight strip
          // or the MobileTabBar along with it.
          style={{ overscrollBehavior: "contain" }}
        >
          {/* Chat fills the area edge-to-edge + full height; other pages
              keep the padded, max-width container under the desktop topbar. */}
          {fullBleed ? (
            <div className="h-full">
              <Outlet />
            </div>
          ) : (
            <>
              <Topbar />
              <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
                <Outlet />
              </div>
            </>
          )}
        </main>
      </div>

      {/* Bottom-tab nav — mobile only. Hidden inside Cash Management, which
          takes over the bottom bar with its own section nav. */}
      {!isCash && <MobileTabBar onMoreClick={() => setMoreOpen(true)} />}

      {/* First-run nudges, held back until the launch splash clears.
          Install takes priority over push so only one bottom card shows;
          the push primer appears once install is dismissed or N/A. */}
      {!splash.active && install.show && <InstallPrimer {...install} />}
      {!splash.active && !install.show && <PushPrimer />}

      {/* First-load personalized launch splash, fades into the home. */}
      {splash.active && (
        <div
          className={cn(
            "fixed inset-0 z-[60] transition-opacity duration-500",
            splash.fading ? "opacity-0" : "opacity-100",
          )}
          aria-hidden={splash.fading}
        >
          <LaunchSplash
            greeting={greetingFor(profile?.full_name)}
            subline={splashSubline}
          />
        </div>
      )}
    </div>
  );
}
