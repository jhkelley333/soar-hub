// Labor v2 — client wrappers around the labor-v2 function (admin rollup +
// the GM day view).
import { supabase } from "@/lib/supabase";
import type { GmLaborResponse, LaborStore, ReviewInput } from "@/modules/labor/types";
import type { LaborSummary, TeamLaborResponse } from "./types";

const FN = "/.netlify/functions/labor-v2";

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

function callWith(path: string, init: RequestInit, token: string): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await callWith(path, init, await authToken());
  // A 401 usually means the stored access token went stale — refresh the
  // session once and retry before surfacing "unauthorized".
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    const fresh = data.session?.access_token;
    if (fresh) res = await callWith(path, init, fresh);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function fetchLaborSummary(opts?: { date?: string; refresh?: boolean }): Promise<LaborSummary> {
  const p = new URLSearchParams({ action: "summary" });
  if (opts?.date) p.set("date", opts.date);
  if (opts?.refresh) p.set("refresh", "1");
  return req(`${FN}?${p.toString()}`);
}

export function fetchLaborDates(): Promise<{ dates: string[] }> {
  return req(`${FN}?action=dates`);
}

export interface PullLogEntry {
  id: string;
  created_at: string;
  source: string;            // 'cron' | 'refresh' | 'self-heal'
  ok: boolean;
  business_date: string | null;
  store_rows: number | null;
  wtd_rows: number | null;
  ptd_rows: number | null;
  kpi_snapshot: boolean | null;
  central_date: string | null;
  central_hour: number | null;
  triggered_by: string | null;
  duration_ms: number | null;
  error: string | null;
}

export function fetchPullLog(): Promise<{ entries: PullLogEntry[] }> {
  return req(`${FN}?action=pull-log`);
}

// ── Leadership "Team labor" rollup (drill Region → Market → District → Store) ─
export function fetchLaborV2Team(date?: string): Promise<TeamLaborResponse> {
  const p = new URLSearchParams({ action: "team" });
  if (date) p.set("date", date);
  return req(`${FN}?${p.toString()}`);
}

// ── GM day view ──────────────────────────────────────────────────────
export function fetchLaborV2Stores(): Promise<{ stores: LaborStore[] }> {
  return req(`${FN}?action=my-stores`);
}

export function fetchLaborV2Gm(store: string, date?: string): Promise<GmLaborResponse> {
  const p = new URLSearchParams({ action: "gm", store });
  if (date) p.set("date", date);
  return req(`${FN}?${p.toString()}`);
}

export function saveLaborV2Review(input: ReviewInput): Promise<{ ok: true; review: { id: string; note: string } }> {
  return req(`${FN}?action=review`, { method: "POST", body: JSON.stringify(input) });
}

// ── Weekly Labor Miss Tracker (CSV export) ───────────────────────────
export interface MissTrackerRow {
  store_number: string;
  store_name: string | null;
  total: number;
  /** ISO date → hours missed that day (over days only). */
  days: Record<string, number>;
  /** ISO date → "Root Cause — note" filed for that day. */
  explanations: Record<string, string>;
}

export interface MissTrackerResponse {
  week: string[]; // the 7 ISO dates, Mon → Sun
  threshold: number;
  rows: MissTrackerRow[];
}

export function fetchMissTracker(weekStart: string): Promise<MissTrackerResponse> {
  const p = new URLSearchParams({ action: "miss-tracker", week_start: weekStart });
  return req(`${FN}?${p.toString()}`);
}

// ── No-GM labor credit (SDO+) ────────────────────────────────────────
export interface NoGmCreditRow {
  id: string;
  store_number: string;
  store_name: string | null;
  reason: "loa" | "no_gm" | "in_training";
  start_date: string;
  end_date: string | null;
  note: string | null;
  created_by_email: string | null;
  created_at: string;
  active: boolean;
}

export function fetchNoGmCredits(): Promise<{ rows: NoGmCreditRow[]; weekly: number }> {
  return req(`${FN}?action=no-gm-list`);
}

export function addNoGmCredit(input: {
  store_number: string; reason: string; start_date: string; end_date?: string; note?: string;
}): Promise<{ row: NoGmCreditRow }> {
  return req(`${FN}?action=no-gm-add`, { method: "POST", body: JSON.stringify(input) });
}

export function endNoGmCredit(id: string, endDate: string): Promise<{ ok: true }> {
  return req(`${FN}?action=no-gm-end`, { method: "POST", body: JSON.stringify({ id, end_date: endDate }) });
}

export function deleteNoGmCredit(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=no-gm-delete`, { method: "POST", body: JSON.stringify({ id }) });
}

export function setNoGmWeeklyRate(amount: number): Promise<{ ok: true; amount: number }> {
  return req(`${FN}?action=no-gm-rate-set`, { method: "POST", body: JSON.stringify({ amount }) });
}
