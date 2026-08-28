// useActivityHeartbeat — lightweight "last seen" presence.
//
// While a user is signed in and the tab is visible, this upserts their row in
// user_activity (RLS: self-write only) so the admin User Activity page can show
// who's been active recently. Deliberately cheap: fires once on mount, again
// whenever the tab becomes visible, and on a slow interval otherwise — with a
// hard 1/min floor so route changes and visibility flaps can't spam writes.
// Entirely best-effort: a failed heartbeat never surfaces to the user.
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

const INTERVAL_MS = 3 * 60 * 1000; // heartbeat cadence while active
const MIN_GAP_MS = 60 * 1000;      // never write more than once a minute

export function useActivityHeartbeat(userId: string | null | undefined) {
  const lastSent = useRef(0);

  useEffect(() => {
    if (!userId) return;

    const beat = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastSent.current < MIN_GAP_MS) return;
      lastSent.current = now;
      try {
        await supabase.from("user_activity").upsert(
          {
            user_id: userId,
            last_seen_at: new Date().toISOString(),
            last_path: typeof location !== "undefined" ? location.pathname.slice(0, 200) : null,
            user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      } catch {
        // best-effort presence — swallow (offline, RLS, table missing pre-migration)
      }
    };

    void beat(); // once on mount
    const onVisible = () => { if (document.visibilityState === "visible") void beat(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void beat(), INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [userId]);
}
