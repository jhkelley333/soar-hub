import { supabase } from "@/lib/supabase";

const BASE = "/.netlify/functions/obsession";

async function authedFetch(url: string, options?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options?.headers ?? {}) },
  });
  if (res.status === 401) {
    await supabase.auth.refreshSession();
    const { data: d2 } = await supabase.auth.getSession();
    const t2 = d2.session?.access_token;
    const r2 = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2}`, ...(options?.headers ?? {}) },
    });
    return r2.json();
  }
  return res.json();
}

export interface ObsessionConfig {
  id: string;
  metric_key: string;
  metric_label: string;
  metric_direction: "higher" | "lower";
  metric_format: "pct" | "dollars" | "score" | "number";
  target_value: number;
  baseline_value: number | null;
  start_date: string;
  end_date: string;
  is_active: boolean;
  headline: string | null;
  created_at: string;
}

export interface LeaderboardRow {
  storeNumber: string;
  storeName: string;
  avg: number;
}

export interface ConfigResponse {
  config: ObsessionConfig | null;
  currentValue: number | null;
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  config: ObsessionConfig | null;
}

export async function fetchObsessionConfig(): Promise<ConfigResponse> {
  return authedFetch(`${BASE}?action=config`);
}

export async function fetchLeaderboard(): Promise<LeaderboardResponse> {
  return authedFetch(`${BASE}?action=leaderboard`);
}

export interface SavePayload {
  metricKey: string;
  targetValue: number;
  startDate: string;
  endDate: string;
  headline?: string;
}

export async function saveObsession(payload: SavePayload): Promise<{ config: ObsessionConfig }> {
  return authedFetch(`${BASE}?action=save`, { method: "POST", body: JSON.stringify(payload) });
}

export const METRIC_CATALOG = [
  { key: "onTimePercentage",    label: "On-Time %",      direction: "higher" as const, format: "pct"     as const },
  { key: "laborPercentage",     label: "Labor %",         direction: "lower"  as const, format: "pct"     as const },
  { key: "netSales",            label: "Net Sales",       direction: "higher" as const, format: "dollars" as const },
  { key: "voidPercentage",      label: "Void %",          direction: "lower"  as const, format: "pct"     as const },
  { key: "dailyScore",          label: "Count Score",     direction: "higher" as const, format: "score"   as const },
  { key: "discountPercentage",  label: "Discount %",      direction: "lower"  as const, format: "pct"     as const },
  { key: "averageTicketAmount", label: "Average Ticket",  direction: "higher" as const, format: "dollars" as const },
  { key: "splh",                label: "SPLH",            direction: "higher" as const, format: "dollars" as const },
];
