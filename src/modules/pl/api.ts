// P&L — typed wrappers around netlify/functions/pl.

import { supabase } from "@/lib/supabase";
import type { ParsedPlStore, PlCompare, PlOverviewRow, PlPeriod, PlStage, PlStatement } from "./types";

const FN = "/.netlify/functions/pl";

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

export function fetchPlPeriods(): Promise<{ periods: PlPeriod[] }> {
  return request(`${FN}?action=periods`);
}

export function fetchPlOverview(period: string): Promise<{ period: string; rows: PlOverviewRow[] }> {
  return request(`${FN}?action=overview&period=${encodeURIComponent(period)}`);
}

export function fetchPlStatement(
  store: string,
  period: string,
  stage?: PlStage,
): Promise<{ statement: PlStatement; available: { prelim: boolean; final: boolean } }> {
  const stageQ = stage ? `&stage=${stage}` : "";
  return request(
    `${FN}?action=statement&store=${encodeURIComponent(store)}&period=${encodeURIComponent(period)}${stageQ}`,
  );
}

export function fetchPlCompare(store: string, period: string): Promise<PlCompare> {
  return request(
    `${FN}?action=compare&store=${encodeURIComponent(store)}&period=${encodeURIComponent(period)}`,
  );
}

export function uploadPl(input: {
  period_end: string;
  period_label: string;
  is_final: boolean;
  statements: ParsedPlStore[];
}): Promise<{ ok: true; upserted: number; unmatched: string[]; duplicates?: string[] }> {
  return request(`${FN}?action=upload`, { method: "POST", body: JSON.stringify(input) });
}

// ── Budget & Targets (store-controllable % of sales) ────────────────
export interface PlBudgetTarget {
  line_key: string;
  label: string;
  group_key: string | null;
  is_group: boolean;
  target_pct: number | null;
  verify_on_zero: boolean;
  enabled: boolean;
  sort_order: number;
  updated_at?: string;
}
export function fetchPlBudget(): Promise<{ targets: PlBudgetTarget[] }> {
  return request(`${FN}?action=budget`);
}
export function savePlBudget(
  updates: { line_key: string; target_pct: number | null; verify_on_zero?: boolean; enabled?: boolean }[],
): Promise<{ targets: PlBudgetTarget[] }> {
  return request(`${FN}?action=budget-set`, { method: "POST", body: JSON.stringify({ updates }) });
}

// ── Preliminary review: flags + per-flag notes ──────────────────────
export type PlFlagType = "over_budget" | "anomaly" | "verify_zero" | "missing" | "run_rate" | "manual";
export interface PlReviewFlag {
  line_key: string;
  label: string;
  stmt_label: string;
  type: PlFlagType;
  severity: "high" | "med" | "low";
  actual_pct: number | null;
  actual_amount: number | null;
  target_pct: number | null;
  variance_pts: number | null;
  dollars_over: number | null;
  context: string[];
  message: string;
}
export interface PlReviewNote {
  id: string;
  line_key: string;
  root_cause: string | null;
  action_steps: string | null;
  author_id: string;
  author_name: string | null;
  author_role: string | null;
  created_at: string;
  updated_at: string;
}
export interface PlReviewSignoff {
  signed_by_id: string;
  signed_by_name: string | null;
  signed_by_role: string | null;
  signed_at: string;
  stale: boolean; // a note was added/edited after this sign-off
}
export interface PlReviewResponse {
  store: { number: string; name: string | null };
  stage: PlStage;
  total_sales: number | null;
  flags: PlReviewFlag[];
  notes: PlReviewNote[];
  my_author_id: string;
  signoff: PlReviewSignoff | null;
  can_sign: boolean;
}
export function fetchPlReview(store: string, period: string): Promise<PlReviewResponse> {
  return request(`${FN}?action=review&store=${encodeURIComponent(store)}&period=${encodeURIComponent(period)}`);
}

// Per-store review status for a period (which stores still owe notes).
export interface PlReviewSummaryRow { store_number: string; flags: number; noted: number; owed: number }
export function fetchPlReviewSummary(period: string): Promise<{ period: string; rows: PlReviewSummaryRow[] }> {
  return request(`${FN}?action=review-summary&period=${encodeURIComponent(period)}`);
}

// Roll-up of the caller's stores aggregated by DO / SDO / RVP.
export type RollupGroupBy = "do" | "sdo" | "rvp";
export interface PlRollupStore {
  store_number: string;
  store_name: string | null;
  total_sales: number;
  ci_amount: number;
  ci_pct: number | null;
  flags: number;
  owed: number;
  dollars_over: number;
  signed: boolean;
  signed_stale: boolean;
}
export interface PlRollupGroup {
  name: string;
  stores: number;
  total_sales: number;
  ci_amount: number;
  ci_pct: number | null;
  flags: number;
  owed: number;
  dollars_over: number;
  signed_count: number;       // stores in this group with a current (non-stale) sign-off
  stores_detail: PlRollupStore[];
}
export function fetchPlRollup(period: string, groupBy: RollupGroupBy): Promise<{ period: string; group_by: RollupGroupBy; groups: PlRollupGroup[] }> {
  return request(`${FN}?action=review-rollup&period=${encodeURIComponent(period)}&group_by=${groupBy}`);
}
export function savePlReviewNote(input: {
  store: string; period: string; line_key: string; root_cause: string; action_steps: string;
}): Promise<{ note: PlReviewNote }> {
  return request(`${FN}?action=review-note`, { method: "POST", body: JSON.stringify(input) });
}
export function updatePlReviewNote(input: {
  id: string; root_cause: string; action_steps: string;
}): Promise<{ note: PlReviewNote }> {
  return request(`${FN}?action=review-note-update`, { method: "POST", body: JSON.stringify(input) });
}
export function deletePlReviewNote(input: { id: string }): Promise<{ ok: true }> {
  return request(`${FN}?action=review-note-delete`, { method: "POST", body: JSON.stringify(input) });
}
export function savePlReviewSignoff(input: { store: string; period: string }): Promise<{ signoff: PlReviewSignoff }> {
  return request(`${FN}?action=review-signoff`, { method: "POST", body: JSON.stringify(input) });
}

// ── Manual (team-created) flags on any statement line ───────────────
export interface PlManualFlag {
  id: string;
  line_key: string;
  line_label: string;
  reason: string | null;
  flagged_by_id: string;
  flagged_by_name: string | null;
  flagged_by_role: string | null;
  created_at: string;
  updated_at: string;
}
export function fetchPlManualFlags(store: string, period: string): Promise<{ flags: PlManualFlag[]; my_id: string; can_flag: boolean }> {
  return request(`${FN}?action=manual-flags&store=${encodeURIComponent(store)}&period=${encodeURIComponent(period)}`);
}
export function savePlManualFlag(input: { store: string; period: string; line_label: string; reason: string }): Promise<{ flag: PlManualFlag }> {
  return request(`${FN}?action=manual-flag`, { method: "POST", body: JSON.stringify(input) });
}
export function deletePlManualFlag(input: { id: string }): Promise<{ ok: true }> {
  return request(`${FN}?action=manual-flag-delete`, { method: "POST", body: JSON.stringify(input) });
}

// ── Line-item trend across periods ──────────────────────────────────
export interface PlTrendPoint {
  period_end: string;
  period_label: string | null;
  amount: number | null;
  pct: number | null;
}
export function fetchPlLineTrend(store: string, label: string): Promise<{ store: string; label: string; points: PlTrendPoint[] }> {
  return request(`${FN}?action=line-trend&store=${encodeURIComponent(store)}&label=${encodeURIComponent(label)}`);
}

// ── Walkthrough flags (Google Sheet) + notes write-back ─────────────

const FLAGS_FN = "/.netlify/functions/pl-flags";

export interface PlFlag {
  sheet_row: number;
  category: string;
  item: string | null;
  value: string | null;
  rule: string | null;
  prior_1: string | null;
  prior_2: string | null;
  sheet_note: string | null;
  note?: string;
  noted_by?: string;
  noted_at?: string;
  // Notes written for this same store/category/item in earlier periods (most
  // recent first) — surfaced when an item is flagged again.
  prior_notes?: { period_end: string; note: string; noted_by_name: string | null; updated_at: string }[];
}

export interface PlFlagStore {
  store_number: string;
  store_name: string | null;
  gm: string | null;
  flags: PlFlag[];
}

export function fetchPlFlags(store?: string): Promise<{ period_end: string | null; stores: PlFlagStore[] }> {
  return request(`${FLAGS_FN}?action=flags${store ? `&store=${encodeURIComponent(store)}` : ""}`);
}

export function savePlFlagNote(input: {
  period_end: string;
  store_number: string;
  category: string;
  item: string;
  sheet_row: number;
  note: string;
}): Promise<{ ok: true; sheet_written: boolean; sheet_reason: string | null }> {
  return request(`${FLAGS_FN}?action=note`, { method: "POST", body: JSON.stringify(input) });
}
