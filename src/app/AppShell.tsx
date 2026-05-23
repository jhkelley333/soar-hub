// AppShell — chrome around the authenticated app. Responsive:
//
//   lg+   — sidebar nav on the left, max-w-7xl content container with
//           the existing desktop padding. Same as before.
//   < lg  — no sidebar in flow, no top hamburger bar. Content keeps
//           the same padded container so legacy pages render the way
//           they used to; mobile-first pages set their own max-w-md
//           inside and ignore it. Bottom-tab nav at the bottom for
//           the three most common destinations + a More tab that
//           opens the full sidebar as a slide-in drawer, so nothing
//           in the existing nav becomes unreachable. Each screen now
//           brings its own AppHeader when it needs one.
//
// This is the foundation for the "feels like an app" experience on
// mobile. Combined with the PWA manifest + service worker (separate
// PR) it gives installed users a true standalone phone experience.

import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/app/Sidebar";
import { MobileTabBar } from "@/app/MobileTabBar";
import { useIdleLogout } from "@/auth/useIdleLogout";

export function AppShell() {
  const [moreOpen, setMoreOpen] = useState(false);
  // 2-hour idle auto-logout. Only active while a session exists (the
  // hook bails internally otherwise).
  useIdleLogout();

  return (
    <div className="flex h-full bg-surface-muted">
      {/* Sidebar — always visible on lg+. On mobile it only renders
          while the More drawer is open, on top of the content. */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

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

      {/* The iOS safe-area inset lives on #root in globals.css so every
          page (AppShell, LandingPage, LoginPage) inherits it. No per-
          shell padding here. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto">
          {/* Container restores the existing padded layout for
              legacy pages. Mobile-first pages set their own
              `mx-auto max-w-md` inside, which lives comfortably
              inside this wrapper at every viewport. */}
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
            <Outlet />
          </div>
          {/* Reserve room at the bottom of the scroll area for the
              mobile tab bar so it can't sit on top of the last
              piece of content. Desktop hides this spacer. */}
          <div
            className="h-16 lg:hidden"
            style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
            aria-hidden
          />
        </main>

        {/* Bottom-tab nav — mobile only. Sits on top of content, lifted
            above the iOS home indicator via safe-area inset. */}
        <MobileTabBar onMoreClick={() => setMoreOpen(true)} />
      </div>
    </div>
  );
}
