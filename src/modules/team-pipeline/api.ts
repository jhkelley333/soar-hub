// Typed wrappers around netlify/functions/team-pipeline.
import { supabase } from "@/lib/supabase";
import type { GmsResponse, RollupResponse, StoreRosterResponse } from "./types";

const FN = "/.netlify/functions/team-pipeline";

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
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchRollup(): Promise<RollupResponse> {
  return request<RollupResponse>(`${FN}?action=rollup`);
}
export function fetchGms(): Promise<GmsResponse> {
  return request<GmsResponse>(`${FN}?action=gms`);
}
export function fetchStoreRoster(storeId: string): Promise<StoreRosterResponse> {
  return request<StoreRosterResponse>(`${FN}?action=store-roster&store_id=${encodeURIComponent(storeId)}`);
}
export function seedFromProfiles(): Promise<{ ok: true; created: number }> {
  return request(`${FN}?action=seed-from-profiles`, { method: "POST", body: "{}" });
}
export interface CommitPlanInput {
  store_id: string;
  hires: Record<string, number>;
  promotions: { member_id: string; to_role: string }[];
}
export function commitPlan(input: CommitPlanInput): Promise<{ ok: true; promoted: number; reqs_opened: number }> {
  return request(`${FN}?action=commit-plan`, { method: "POST", body: JSON.stringify(input) });
}
