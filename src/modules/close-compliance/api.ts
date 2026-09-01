// Close-Time Watch — client wrapper around the close-compliance function.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/close-compliance";

async function req<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export type CloseView = "daily" | "weekly" | "monthly";
export type CloseStatus = "flag" | "warn" | "good";

export interface DailyStore {
  number: string; name: string; do: string;
  status: CloseStatus; delta: number; close: string | null; out: string | null;
  overnight: boolean; special: boolean;
}
export interface AggDay { date: string; status: CloseStatus; delta: number }
export interface AggStore {
  number: string; name: string; do: string;
  eval_days: number; early_days: number; borderline_days: number;
  worst_delta: number | null; rate: number; days: AggDay[];
}
export interface CloseGroup {
  do: string; flagged: number; count: number;
  stores: (DailyStore | AggStore)[];
}
export interface CloseTotals {
  evaluated?: number; flagged?: number; borderline?: number; on_time?: number;
  avg_early_min?: number; on_time_pct?: number | null;
  stores_flagged?: number; repeat_offenders?: number; events?: number;
  worst?: { number: string; name: string; delta?: number; early_days?: number; eval_days?: number } | null;
}
export interface CloseSummary {
  view: CloseView; date: string | null;
  range?: { start: string; end: string };
  period?: number | null; week?: number | null;
  grace_min: number; no_hours_days?: number;
  groups: CloseGroup[]; totals: CloseTotals;
  message?: string;
}

export function fetchCloseSummary(view: CloseView, date?: string): Promise<CloseSummary> {
  const qs = new URLSearchParams({ action: "summary", view });
  if (date) qs.set("date", date);
  return req(`${FN}?${qs.toString()}`);
}
