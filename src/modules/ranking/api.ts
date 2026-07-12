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

// ── Runs ─────────────────────────────────────────────────────────────
export type RankScope = "ptd" | "wtd";
export type RankTier = "store" | "do" | "sdo" | "rvp" | "entity" | "company";

export interface RankingIssue { level: "info" | "warn" | "bad"; msg: string }

export interface RankingRun {
  id: string;
  week_ending: string;
  period: number;
  week: number;
  weeks_in_period: number;
  config_version: string;
  snapshot_date: string | null;
  week_misaligned: boolean;
  status: string;
  issues: RankingIssue[];
  source_status: Record<string, { status: string; stores?: number; note?: string }>;
  started_at: string;
  completed_at: string | null;
}

// The engine's Row — dynamic; typed loosely and read via helpers in the view.
export type RankMetrics = Record<string, number | string | null>;

export interface RankingResultRow {
  entity_key: string;
  store_id: string | null;
  rank: number | null;
  total_points: number | null;
  metrics: RankMetrics;
}

export function fetchRankingLatest(scope: RankScope, tier: RankTier): Promise<{
  run: RankingRun | null; scope: RankScope; tier: RankTier; rows: RankingResultRow[];
}> {
  const p = new URLSearchParams({ action: "run-latest", scope, tier });
  return req(`${FN}?${p.toString()}`);
}

export function triggerRankingRun(): Promise<{ run_id: string; week_ending: string; period: number; week: number; rows: number; issues: RankingIssue[] }> {
  return req(`${FN}?action=run-now`, { method: "POST", body: "{}" });
}
