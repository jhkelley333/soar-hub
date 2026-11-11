import { supabase } from "@/lib/supabase";
import type { SchedSummaryResp, SchedWeeksResp, SchedHistoryResp } from "./types";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const headers = await authHeader();
  const res = await fetch(`/.netlify/functions/schedule-status?${qs}`, { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as T;
}

export async function fetchSchedWeeks(): Promise<SchedWeeksResp> {
  return apiFetch<SchedWeeksResp>({ action: "weeks" });
}

export async function fetchSchedSummary(week: string): Promise<SchedSummaryResp> {
  return apiFetch<SchedSummaryResp>({ action: "summary", week });
}

export async function fetchSchedHistory(week: string): Promise<SchedHistoryResp> {
  return apiFetch<SchedHistoryResp>({ action: "history", week });
}
