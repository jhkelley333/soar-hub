// Daily Count — typed wrappers around netlify/functions/count.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/count";

export interface CountRow {
  store_number: string;
  store_name: string | null;
  do_name: string | null;
  sdo_name: string | null;
  rvp_name: string | null;
  daily_score: number | null;
  completion_score: number | null;
  accuracy_score: number | null;
  total_intellicost_pct: number | null;
  wow_daily: number | null;
  wow_completion: number | null;
  wow_accuracy: number | null;
}

// A rolled-up group (a DO, SDO, RVP, or the whole company): each score is the
// average across the group's stores, with a week-over-week delta.
export interface CountRollup {
  label: string;
  store_count: number;
  daily_score: number | null;
  completion_score: number | null;
  accuracy_score: number | null;
  wow_daily: number | null;
  wow_completion: number | null;
  wow_accuracy: number | null;
}

export interface CountRollups {
  company: CountRollup | null;
  rvp: CountRollup[];
  sdo: CountRollup[];
  do: CountRollup[];
}

export interface CountTrendPoint {
  business_date: string;
  daily_score: number | null;
  completion_score: number | null;
  accuracy_score: number | null;
  total_intellicost_pct: number | null;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchCountOverview(date?: string): Promise<{ date: string | null; rows: CountRow[]; rollups?: CountRollups }> {
  return request(`${FN}?action=overview${date ? `&date=${encodeURIComponent(date)}` : ""}`);
}

export function fetchCountTrend(store: string): Promise<{ store_number: string; store_name: string | null; history: CountTrendPoint[] }> {
  return request(`${FN}?action=trend&store=${encodeURIComponent(store)}`);
}

export function refreshCount(): Promise<{ ok: true; business_date: string; upserted: number; note?: string }> {
  return request(`${FN}?action=refresh`, { method: "POST", body: "{}" });
}
