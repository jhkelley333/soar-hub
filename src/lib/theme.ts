// Theme (light / dark) — class-based dark mode for the redesigned shell +
// dashboard. The actual class toggle on <html> happens in two places:
//   1. A tiny inline script in index.html applies the stored choice BEFORE
//      first paint, so there's no flash of the wrong theme on reload.
//   2. This hook keeps React in sync and writes changes back to the same
//      localStorage key the inline script reads.
//
// Persisted under `soar-theme` as 'light' | 'dark'. Default is light when
// nothing is stored — existing module pages aren't dark-themed yet, so we
// don't opt users in automatically; dark is reachable via the topbar toggle.

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "soar-theme";

export function getStoredTheme(): Theme {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  }
  return "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  // Keep the DOM class + storage in step with state. The inline boot script
  // already set the initial class; this reconciles after hydration and on
  // every change.
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode / storage disabled — non-fatal */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return { theme, setTheme, toggle };
}
