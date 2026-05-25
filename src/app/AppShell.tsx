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
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/app/Sidebar";
import { MobileTabBar } from "@/app/MobileTabBar";
import { PushPrimer } from "@/app/PushPrimer";
import { useIdleLogout } from "@/auth/useIdleLogout";
import { useAuth } from "@/auth/AuthProvider";
import { LaunchSplash } from "@/auth/LaunchSplash";
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
  // 2-hour idle auto-logout. Only active while a session exists (the
  // hook bails internally otherwise).
  useIdleLogout();

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
    <div className="flex h-lvh flex-col bg-surface-muted">
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
          {/* Container restores the existing padded layout for legacy
              pages. Mobile-first pages set their own `mx-auto max-w-md`
              inside, which lives comfortably inside this wrapper at
              every viewport. */}
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Bottom-tab nav — mobile only, lives as a real flex row in the
          column above so content can never scroll past it. */}
      <MobileTabBar onMoreClick={() => setMoreOpen(true)} />

      {/* First-run push opt-in. Self-gates on platform + prior dismissal;
          held back until the launch splash clears. */}
      {!splash.active && <PushPrimer />}

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
