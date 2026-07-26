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
}

const FN = "/.netlify/functions/kpi-board";

export async function fetchKpiBoard(level: string, id?: string | null): Promise<BoardResponse> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const p = new URLSearchParams({ level });
  if (id) p.set("id", id);
  const res = await fetch(`${FN}?${p.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as BoardResponse;
}
