// Execution Metrics Board — client wrapper for the kpi-board function.
import { supabase } from "@/lib/supabase";

export type ValPair = [number | null, number | null];
export interface MetricValues {
  daily: ValPair;
  wtd: ValPair;
  mtd: ValPair;
  weeks: (number | null)[];
}
export interface BoardScopes {
  regions: string[];
  stores: { number: string; name: string; region: string | null }[];
}
export interface BoardResponse {
  anchor: string | null;
  fiscal: { period: number; weekInPeriod: number; weekStart: string; weekEnd: string } | null;
  scope?: { level: string; id: string | null };
  scopes: BoardScopes;
  values: Record<string, MetricValues>;
  // Target overrides by metric id (admin-set) plus the data-driven labor target.
  // The board uses these over the catalog defaults.
  targets?: Record<string, number>;
}

const FN = "/.netlify/functions/kpi-board";

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Not signed in");
  return t;
}

// `date` (YYYY-MM-DD) anchors the board on a past week; omit for the latest.
export async function fetchKpiBoard(level: string, id?: string | null, date?: string | null): Promise<BoardResponse> {
  const p = new URLSearchParams({ level });
  if (id) p.set("id", id);
  if (date) p.set("date", date);
  const res = await fetch(`${FN}?${p.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as BoardResponse;
}

// Admin: set (number) or clear (null) a metric's target override.
export async function setBoardTarget(metricId: string, target: number | null): Promise<void> {
  const res = await fetch(`${FN}?action=set-target`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ metric_id: metricId, target }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  }
}
