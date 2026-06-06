// Topbar — desktop-only sticky header for the redesigned shell. Holds the
// global search, a region/scope filter, the light/dark theme toggle, and the
// notifications bell. Hidden under lg (mobile keeps its own status strip +
// MobileTabBar). Data wiring (search results, region scope, live bell count)
// lands in a later phase — the controls are in place and styled here.

import { Search, ChevronDown, Sun, Moon, Bell } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";

export function Topbar() {
  const { theme, toggle } = useTheme();

  return (
    <header
      className={cn(
        "sticky top-0 z-30 hidden items-center gap-3 border-b px-6 py-3 lg:flex",
        "border-zinc-200 bg-white/90 backdrop-blur",
        "dark:border-night-line dark:bg-night/85",
      )}
    >
      {/* Global search */}
      <div className="relative max-w-xl flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-night-muted"
          strokeWidth={1.75}
        />
        <input
          type="search"
          placeholder="Search stores, work orders, people…"
          aria-label="Search"
          className={cn(
            "h-9 w-full rounded-xl border pl-9 pr-3 text-sm outline-none transition",
            "border-zinc-200 bg-zinc-50 text-ink placeholder:text-zinc-400",
            "focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20",
            "dark:border-night-line dark:bg-night-raised dark:text-night-ink dark:placeholder:text-night-muted dark:focus:bg-night-raised",
          )}
        />
      </div>

      {/* Region / scope filter (static for now — wired to user scope later) */}
      <button
        type="button"
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition",
          "border-zinc-200 bg-white text-ink-muted hover:border-accent hover:text-ink",
          "dark:border-night-line dark:bg-night-raised dark:text-night-muted dark:hover:text-night-ink",
        )}
      >
        All regions
        <ChevronDown className="h-4 w-4 opacity-70" strokeWidth={2} />
      </button>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={theme === "dark" ? "Light mode" : "Dark mode"}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-xl border transition",
          "border-zinc-200 bg-white text-ink-muted hover:border-accent hover:text-ink",
          "dark:border-night-line dark:bg-night-raised dark:text-night-muted dark:hover:text-night-ink",
        )}
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Moon className="h-4 w-4" strokeWidth={1.75} />
        )}
      </button>

      {/* Notifications */}
      <button
        type="button"
        aria-label="Notifications"
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-xl border transition",
          "border-zinc-200 bg-white text-ink-muted hover:border-accent hover:text-ink",
          "dark:border-night-line dark:bg-night-raised dark:text-night-muted dark:hover:text-night-ink",
        )}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-cherry ring-2 ring-white dark:ring-night" />
      </button>
    </header>
  );
}
