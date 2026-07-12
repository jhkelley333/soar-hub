// Ranking module (build phase) — client wrappers for ranking-admin.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/ranking-admin";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface RankingConfigRow {
  id: string;
  key: string;
  value: unknown;
  effective_from: string;
  note: string | null;
  created_at: string;
}

export interface RankingStoreRow {
  store_id: string;
  number: string;
  name: string;
  entity: string | null;
  labor_pad: number | null;
}

export function fetchRankingOverview(): Promise<{ config: RankingConfigRow[]; stores: RankingStoreRow[] }> {
  return req(`${FN}?action=overview`);
}

export function addRankingConfig(input: {
  key: string; value: unknown; effective_from: string; note?: string;
}): Promise<{ row: RankingConfigRow }> {
  return req(`${FN}?action=config-add`, { method: "POST", body: JSON.stringify(input) });
}

export function setLaborPad(storeId: string, laborPad: number | null): Promise<{ ok: true }> {
  return req(`${FN}?action=pad-set`, { method: "POST", body: JSON.stringify({ store_id: storeId, labor_pad: laborPad }) });
}
