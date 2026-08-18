// Client for the ranker history backfill (ranker-backfill + its background job).

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/ranker-backfill";
const FN_BG = "/.netlify/functions/ranker-backfill-background";
const FN_RESCORE = "/.netlify/functions/ranker-rescore-background";

export interface BackfillStatus {
  rows_total: number;
  rows_sheet: number;
  rows_db: number;
  last_imported_at: string | null;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function fetchBackfillStatus(): Promise<BackfillStatus> {
  const res = await fetch(`${FN}?action=status`, { headers: await authHeaders() });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const b = await res.json();
      if (b?.error) message = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<BackfillStatus>;
}

// Fire-and-forget — the background job returns 202 immediately and keeps running.
export async function startBackfill(): Promise<void> {
  await fetch(FN_BG, { method: "POST", headers: await authHeaders(), body: "{}" });
}

// Re-run every completed v2 week with the current scoring formula, then refresh
// the history. Background; returns 202 immediately.
export async function startRescore(): Promise<void> {
  await fetch(FN_RESCORE, { method: "POST", headers: await authHeaders(), body: "{}" });
}
