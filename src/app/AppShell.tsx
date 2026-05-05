import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sidebar } from "@/app/Sidebar";
import { useIdleLogout } from "@/auth/useIdleLogout";

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  // 2-hour idle auto-logout. Only active while a session exists (the
  // hook bails internally otherwise).
  useIdleLogout();

  return (
    <div className="flex h-full bg-zinc-50">
      {/* Sidebar — always visible on lg+, slide-out drawer below lg */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {navOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-zinc-900/40 lg:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar with hamburger */}
        <div className="flex h-12 items-center gap-3 border-b border-zinc-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-midnight transition hover:bg-zinc-100"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-midnight text-xs font-semibold text-white">
            S
          </div>
          <div className="text-sm font-semibold tracking-tight text-midnight">SOAR Hub</div>
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

