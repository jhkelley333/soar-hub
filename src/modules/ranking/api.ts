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

export interface BackfillResult {
  filled: number;
  already: number;
  failed: { date: string; error: string }[];
  remaining: string[];
}

// Re-extract stored KPI snapshots into labor_v2_daily's 0238 fields
// (tickets / on-time / voids) for recent days. Budget-limited server-side;
// call again with the same days while `remaining` is non-empty.
export function backfillRankingFields(days: number): Promise<BackfillResult> {
  return req(`${FN}?action=backfill`, { method: "POST", body: JSON.stringify({ days }) });
}

// ── Source ingestion ─────────────────────────────────────────────────
export interface IxIngestResult {
  file_id: string;
  week_ending: string | null;
  scope: RankScope;
  rows: number;
  stores: number;
  unresolved: string[];
  flash: number;
}

export function ingestIxFile(input: { filename: string; content: string; scope: RankScope }): Promise<IxIngestResult> {
  return req(`${FN}?action=ingest-ix`, { method: "POST", body: JSON.stringify(input) });
}

// ── Legacy history + trends ──────────────────────────────────────────
export interface LegacyImportResult {
  available: number;
  imported: { week: number; rows: number }[];
  skipped: number;
  remaining: number[];
}

export function importLegacyHistory(): Promise<LegacyImportResult> {
  return req(`${FN}?action=import-legacy`, { method: "POST", body: "{}" });
}

export interface TrendWeek { fiscal_week: number; week_ending: string; label: string; source: "sheet" | "hub" }
export interface TrendStore {
  name: string | null;
  gm: string | null;
  rank: (number | null)[];
  labor: (number | null)[];
  vsly: (number | null)[];
  cogs: (number | null)[];
  ontime: (number | null)[];
  sales: (number | null)[];
}

export function fetchRankingTrends(weeks = 26): Promise<{ weeks: TrendWeek[]; stores: Record<string, TrendStore> }> {
  const p = new URLSearchParams({ action: "trends", weeks: String(weeks) });
  return req(`${FN}?${p.toString()}`);
}

// ── Risk ─────────────────────────────────────────────────────────────
export type RiskKind = "performance" | "people" | "data";
export interface RiskReason { kind: RiskKind; pts: number; label: string }
export interface RiskStore {
  number: string;
  name: string | null;
  gm: string | null;
  rank: number | null;
  points: number | null;
  score: number;
  bucket: "high" | "watch" | "low";
  reasons: RiskReason[];
}

export function fetchRankingRisk(): Promise<{
  generated_from_weeks: number;
  counts: { high: number; watch: number; low: number; stable: number };
  stores: RiskStore[];
}> {
  return req(`${FN}?action=risk`);
}
