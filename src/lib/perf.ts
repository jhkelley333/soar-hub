// Opt-in cold-start profiler. Disabled by default (a no-op, so it's safe
// to ship to prod). Turn it on per-device with `?perf=1` in the URL — the
// flag is remembered in localStorage so it survives the SPA boot and
// subsequent reloads. `?perf=0` clears it.
//
// When enabled, perfReport() prints a phase breakdown of the boot path
// (bundle eval -> React mount -> auth session -> profile fetch ->
// interactive) plus the browser's own navigation/resource timings, so we
// can see whether the cold-start cost is the JS bundle, the auth
// round-trips, or the network — instead of guessing.

const ENABLED: boolean = (() => {
  try {
    if (typeof window === "undefined") return false;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("perf") === "1") {
      window.localStorage.setItem("soar_perf", "1");
      return true;
    }
    if (qs.get("perf") === "0") {
      window.localStorage.removeItem("soar_perf");
      return false;
    }
    return window.localStorage.getItem("soar_perf") === "1";
  } catch {
    return false;
  }
})();

type Phase = { label: string; at: number };
const phases: Phase[] = [];

// Record a named instant, timestamped relative to navigation start
// (performance.now()'s time origin). Cheap and a no-op when disabled.
export function perfMark(label: string): void {
  if (!ENABLED) return;
  phases.push({ label, at: performance.now() });
}

// Dump the collected phases + browser timings to the console. Called once
// the app is interactive. Safe to call when disabled (no-op) or empty.
export function perfReport(): void {
  if (!ENABLED || phases.length === 0) return;

  const rows = phases.map((p, i) => ({
    phase: p.label,
    "t since load (ms)": Math.round(p.at),
    "Δ prev (ms)": i === 0 ? Math.round(p.at) : Math.round(p.at - phases[i - 1].at),
  }));

  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;

  // Biggest script the browser downloaded — usually the main app bundle.
  // Surfaces download + parse cost, the thing route code-splitting fixes.
  const scripts = (
    performance.getEntriesByType("resource") as PerformanceResourceTiming[]
  )
    .filter((r) => r.initiatorType === "script")
    .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
    .slice(0, 3)
    .map((r) => ({
      script: r.name.split("/").pop(),
      "transfer (KB)": Math.round((r.transferSize || 0) / 1024),
      "duration (ms)": Math.round(r.duration),
    }));

  /* eslint-disable no-console */
  console.info("%c[soar perf] cold-start breakdown", "font-weight:bold;color:#2563eb");
  console.table(rows);
  if (nav) {
    console.info(
      `[soar perf] network — TTFB ${Math.round(nav.responseStart)}ms · ` +
        `DOMContentLoaded ${Math.round(nav.domContentLoadedEventEnd)}ms · ` +
        `load ${Math.round(nav.loadEventEnd)}ms`,
    );
  }
  if (scripts.length) console.table(scripts);
  /* eslint-enable no-console */
}
