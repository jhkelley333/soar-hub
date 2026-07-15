// Detects a new deploy while the app stays open (a long-lived PWA/tab won't
// re-fetch index.html on its own) and offers a one-click reload onto it.
//
// index.html is served `no-cache` and its entry bundle is content-hashed
// (/assets/index-<hash>.js), so the deployed hash changes every release. We
// compare the deployed entry to the one this session is running; when they
// diverge, a new version is live. Checks on focus + every 15 min. No-op in dev.

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const ENTRY_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

function runningEntry(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  for (const s of scripts) {
    const m = s.src.match(ENTRY_RE);
    if (m) return m[0];
  }
  return null;
}

async function deployedEntry(): Promise<string | null> {
  try {
    const res = await fetch("/", { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(ENTRY_RE);
    return m ? m[0] : null;
  } catch {
    return null; // offline / transient — try again next tick
  }
}

function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const running = runningEntry();
    if (!running) return; // can't identify our own bundle — don't guess

    let stopped = false;
    const check = async () => {
      if (stopped) return;
      const dep = await deployedEntry();
      if (!stopped && dep && dep !== running) {
        setAvailable(true);
        stopped = true; // latch — one prompt is enough
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };

    const first = window.setTimeout(check, 30_000);
    const interval = window.setInterval(check, 15 * 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return available;
}

export function UpdateBanner() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-[2000] flex justify-center px-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-full bg-midnight px-4 py-2.5 text-sm text-white shadow-lg ring-1 ring-black/10">
        <span className="font-semibold">A new version of SOAR Hub is available.</span>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-midnight hover:bg-zinc-100"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reload
        </button>
      </div>
    </div>
  );
}
