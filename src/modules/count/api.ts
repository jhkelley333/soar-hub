// Daily Count — typed wrappers around netlify/functions/count.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/count";

export interface CountRow {
  store_number: string;
  store_name: string | null;
  daily_score: number | null;
  completion_score: number | null;
  accuracy_score: number | null;
  total_intellicost_pct: number | null;
  wow_daily: number | null;
  wow_completion: number | null;
  wow_accuracy: number | null;
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

export function fetchCountOverview(date?: string): Promise<{ date: string | null; rows: CountRow[] }> {
  return request(`${FN}?action=overview${date ? `&date=${encodeURIComponent(date)}` : ""}`);
}

export function fetchCountTrend(store: string): Promise<{ store_number: string; store_name: string | null; history: CountTrendPoint[] }> {
  return request(`${FN}?action=trend&store=${encodeURIComponent(store)}`);
}

export function refreshCount(): Promise<{ ok: true; business_date: string; upserted: number; note?: string }> {
  return request(`${FN}?action=refresh`, { method: "POST", body: "{}" });
}
