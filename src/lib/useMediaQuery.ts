// Tiny media-query hook. Returns whether the query currently matches and
// updates on change. Used to render the mobile-first vs. desktop variant
// of a page from JS (instead of CSS hidden/block) when mounting both
// would be wasteful — e.g. the heavy Work Orders desktop page shouldn't
// fetch its data on phones.

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && "matchMedia" in window
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

// Tailwind's `lg` breakpoint is 1024px. Matches the `lg:` utilities used
// across AppShell so JS and CSS agree on what "desktop" means.
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
