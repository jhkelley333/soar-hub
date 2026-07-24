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
  do_name: string | null;
  sdo_name: string | null;
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

// GM support-hours credit — a GM supporting other stores gets weekly hours
// credited to their own store (converted to $ via the store's blended wage).
export interface GmSupportCreditRow {
  id: string;
  store_number: string;
  store_name: string | null;
  weekly_hours: number;
  start_date: string;
  end_date: string | null;
  note: string | null;
  created_by_email: string | null;
  created_at: string;
  active: boolean;
}
export function fetchGmSupportCredits(): Promise<{ rows: GmSupportCreditRow[] }> {
  return req(`${FN}?action=gm-support-list`);
}
export function addGmSupportCredit(input: {
  store_number: string; weekly_hours: number; start_date: string; end_date?: string; note?: string;
}): Promise<{ row: GmSupportCreditRow }> {
  return req(`${FN}?action=gm-support-add`, { method: "POST", body: JSON.stringify(input) });
}
export function endGmSupportCredit(id: string, endDate: string): Promise<{ ok: true }> {
  return req(`${FN}?action=gm-support-end`, { method: "POST", body: JSON.stringify({ id, end_date: endDate }) });
}
export function deleteGmSupportCredit(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=gm-support-delete`, { method: "POST", body: JSON.stringify({ id }) });
}

export function setNoGmWeeklyRate(amount: number): Promise<{ ok: true; amount: number }> {
  return req(`${FN}?action=no-gm-rate-set`, { method: "POST", body: JSON.stringify({ amount }) });
}

// ── Public labor share links (Company → RVP → SDO → DO → Store) ───────
export interface ShareBand {
  labor_pct: number | null;
  target_pct: number | null;
  variance_pts: number | null;
  dollars_over: number | null;
  hours_over: number | null;
  act_vs_sched: number | null;
}
export interface HoursTrend {
  this_wtd: number | null;
  last_week: number | null;
  delta: number | null;
  improving: boolean | null;
}
export interface ShareNode {
  level: "company" | "region" | "area" | "district" | "store";
  name: string;
  leader: string | null;
  storeCount: number;
  region: string | null;
  area: string | null;
  district: string | null;
  store_number?: string;
  store_name?: string;
  daily: ShareBand;
  wtd: ShareBand;
  ptd: ShareBand;
  hours_trend: HoursTrend;
  credits: { no_gm: number; pto: number; training: number; gm_support?: number };
}
export interface SharedLaborResponse {
  ok: true;
  date: string | null;
  scope: { kind: "company" | "region"; region: string | null };
  label: string | null;
  company: ShareNode | null;
  levels: { region: ShareNode[]; area: ShareNode[]; district: ShareNode[]; store: ShareNode[] };
}

// PUBLIC — no auth header; the token in the URL is the credential.
export async function fetchSharedLabor(token: string): Promise<SharedLaborResponse> {
  const res = await fetch(`${FN}?action=shared-labor&token=${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as SharedLaborResponse;
}

export interface DayWeather {
  hi: number | null;
  lo: number | null;
  code: number | null;   // WMO weather code
  precip_in: number | null;
}
export interface StoreDay {
  date: string;
  polled: boolean;
  labor_pct: number | null;
  target_pct: number | null;
  variance_pts: number | null;
  dollars_over: number | null;
  hours_over: number | null;
  act_vs_sched: number | null;
  root_cause: string | null;
  note: string | null;
  weather: DayWeather | null;
}
export interface SharedLaborStoreResponse {
  ok: true;
  store_number: string;
  store_name: string | null;
  days: StoreDay[];
}

// PUBLIC — one store's current-week daily labor + any filed miss reason.
export async function fetchSharedLaborStore(token: string, store: string): Promise<SharedLaborStoreResponse> {
  const res = await fetch(`${FN}?action=shared-labor-store&token=${encodeURIComponent(token)}&store=${encodeURIComponent(store)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as SharedLaborStoreResponse;
}

export interface WeekDay {
  date: string;
  labor_pct: number | null;
  wtd_pct: number | null;   // week-to-date labor % through this day
  hours_over: number | null;
  status: "over" | "on" | "unknown" | "missing" | "future";
}
export interface WeekNode { name: string; leader: string | null; week: WeekDay[] }
export interface SharedLaborWeekResponse {
  ok: true;
  level: "region" | "area" | "district" | "store";
  dates: string[];
  week_start: string | null;   // Monday of the returned week
  has_prev: boolean;           // is there data before this week
  has_next: boolean;           // is this week earlier than the latest week
  scope_total: WeekNode | null;
  nodes: WeekNode[];
}

// PUBLIC — Mon→Sun daily strip per node at a level, scoped to the drill path.
// weekOf (any date in the target week) pages to older weeks; omit for latest.
export async function fetchSharedLaborWeek(token: string, opts: {
  level: string; region?: string | null; area?: string | null; district?: string | null; weekOf?: string | null;
}): Promise<SharedLaborWeekResponse> {
  const p = new URLSearchParams({ action: "shared-labor-week", token, level: opts.level });
  if (opts.region) p.set("region", opts.region);
  if (opts.area) p.set("area", opts.area);
  if (opts.district) p.set("district", opts.district);
  if (opts.weekOf) p.set("weekOf", opts.weekOf);
  const res = await fetch(`${FN}?${p.toString()}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as SharedLaborWeekResponse;
}

// PUBLIC — file a miss reason + note from the shared store popup.
export async function submitSharedLaborReview(token: string, input: {
  store: string; date: string; root_cause: string | null; note: string; filed_by: string;
}): Promise<{ ok: true }> {
  const res = await fetch(`${FN}?action=shared-labor-store-review&token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as { ok: true };
}

export interface LaborShare {
  id: string;
  token: string;
  scope_kind: "company" | "region";
  region_id: string | null;
  region_name: string | null;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}
export function fetchLaborShares(): Promise<{ shares: LaborShare[]; regions: { id: string; name: string }[] }> {
  return req(`${FN}?action=labor-shares`);
}
export function mintLaborShare(input: { region_id?: string | null; label?: string }): Promise<{ token: string; id: string; reused: boolean }> {
  return req(`${FN}?action=labor-share-mint`, { method: "POST", body: JSON.stringify(input) });
}
export function revokeLaborShare(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=labor-share-revoke`, { method: "POST", body: JSON.stringify({ id }) });
}
