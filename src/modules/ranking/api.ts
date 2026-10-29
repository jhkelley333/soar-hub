// Ranking module (build phase) — client wrappers for ranking-admin.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/ranking-admin";
const FN_CRED = "/.netlify/functions/ranker-credentials";

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

// ── Temp RVP delegation (admin grants; RVP is limited to uploads + vault) ─────
export function fetchRankerAccess(): Promise<{ ok: true; is_admin: boolean; delegated: boolean; delegation_ends_on: string | null }> {
  return req(`${FN}?action=my-access`);
}
export interface RankerDelegation {
  id: string;
  user_id: string;
  rvp_name: string;
  starts_on: string;
  ends_on: string;
  note: string | null;
  revoked_at: string | null;
  active: boolean;
  scheduled: boolean;
}
export interface RvpOption { id: string; name: string }
export function fetchRankerDelegations(): Promise<{ ok: true; delegations: RankerDelegation[]; rvps: RvpOption[] }> {
  return req(`${FN}?action=delegations-list`);
}
export function grantRankerDelegation(input: { user_ids: string[]; starts_on: string; ends_on: string; note?: string }): Promise<{ ok: true; granted: number; skipped: number }> {
  return req(`${FN}?action=delegation-grant`, { method: "POST", body: JSON.stringify(input) });
}
export function revokeRankerDelegation(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=delegation-revoke`, { method: "POST", body: JSON.stringify({ id }) });
}

// ── Credential vault (admin only) ────────────────────────────────────────────
export interface RankerCredential {
  id: string;
  label: string;
  url: string | null;
  username: string | null;
  password: string | null;
  notes: string | null;
  sort_order: number;
  updated_at: string;
}
export function fetchRankerCredentials(): Promise<{ ok: true; entries: RankerCredential[] }> {
  return req(`${FN_CRED}?action=list`);
}
export function upsertRankerCredential(
  input: Partial<RankerCredential> & { label: string },
): Promise<{ ok: true; entry: RankerCredential }> {
  return req(`${FN_CRED}?action=upsert`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteRankerCredential(id: string): Promise<{ ok: true }> {
  return req(`${FN_CRED}?action=delete`, { method: "POST", body: JSON.stringify({ id }) });
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

export function fetchRankingOverview(): Promise<{ config: RankingConfigRow[]; stores: RankingStoreRow[]; fc_target_efficiency: number }> {
  return req(`${FN}?action=overview`);
}

// ── Bottom performers by SDO (year trend) ────────────────────────────────────
export interface BottomTrend { dir: "improving" | "declining" | "flat"; delta: number }
export interface BottomMetric { key: string; label: string; better_is_higher: boolean }
export interface BottomGM {
  store_number: string; gm: string | null; location: string | null; sdo: string;
  value: number | null; best: number | null; worst: number | null; avg_rank: number | null;
  weeks: number; trend: BottomTrend; series: number[];
}
export interface BottomDO {
  name: string; sdo: string;
  value: number | null; best: number | null; worst: number | null; avg_rank: number | null;
  weeks: number; trend: BottomTrend; series: number[];
}
export interface BottomSdo { sdo: string; store_count: number; do_count: number; bottom_gms: BottomGM[]; bottom_do: BottomDO | null }
export interface BottomPerformers {
  fy_start: string; fy_end: string; weeks: number; gm_per_sdo: number;
  metric: string; metric_label: string; better_is_higher: boolean;
  metrics: BottomMetric[]; sdos: BottomSdo[];
}

export function fetchBottomPerformers(gmPerSdo = 2, metric = "overall"): Promise<BottomPerformers> {
  return req(`${FN}?action=bottom-performers&gm_per_sdo=${gmPerSdo}&metric=${encodeURIComponent(metric)}`);
}

export function setFcTargetEfficiency(efficiency: number): Promise<{ ok: true; efficiency: number }> {
  return req(`${FN}?action=fc-target-set`, { method: "POST", body: JSON.stringify({ efficiency }) });
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
  source_status: Record<string, { status: string; stores?: number; expected?: number | null; polled?: number; missing?: number; note?: string; pending_upload?: boolean; latest_upload_at?: string | null; week_ending?: string; as_of?: string }>;
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

export type ViewScope = "own" | "district" | "company";

export function fetchRankingLatest(scope: RankScope, tier: RankTier, runId?: string | null, viewScope?: ViewScope): Promise<{
  run: RankingRun | null; scope: RankScope; tier: RankTier; rows: RankingResultRow[];
}> {
  const p = new URLSearchParams({ action: "run-latest", scope, tier });
  if (runId) p.set("run_id", runId);
  if (viewScope && viewScope !== "own") p.set("view_scope", viewScope);
  return req(`${FN}?${p.toString()}`);
}

export interface RankingRunSummary {
  id: string;
  week_ending: string;
  period: number;
  week: number;
  started_at: string;
  completed_at: string | null;
}

export function fetchRankingRuns(): Promise<{ runs: RankingRunSummary[] }> {
  return req(`${FN}?action=runs`);
}

// Unified week timeline: hub runs + sheet-era legacy weeks before the cutover.
export interface RankingWeek {
  key: string;
  source: "hub" | "legacy" | "pending";
  run_id: string | null;
  fiscal_week: number | null;
  period: number | null;
  week: number | null;
  week_ending: string;
  // "pending" weeks: the current completed fiscal week that has no run yet (its
  // KPI capture hasn't landed). Shown at the top of the picker as "awaiting data".
  pending?: boolean;
}
export function fetchRankingWeeks(): Promise<{ weeks: RankingWeek[]; legacyImported: boolean }> {
  return req(`${FN}?action=weeks`);
}

// One sheet-era week's store rows (mapped to the new-engine shape, store tier).
export function fetchLegacyWeek(fiscalWeek: number): Promise<{
  run: RankingRun | null; scope: RankScope; tier: RankTier; rows: RankingResultRow[];
}> {
  return req(`${FN}?action=legacy-week&fiscal_week=${fiscalWeek}`);
}

// Week-over-week movers (VP-only): change in points/rank/category scores vs the
// prior week, at one scope + tier.
export interface MoverRun { id: string; period: number; week: number; week_ending: string; completed_at: string | null }
export interface MoverRow {
  entity_key: string;
  name: string | null;
  location: string | null;
  gm: string | null;
  rank_now: number | null;
  rank_prev: number | null;
  d_rank: number | null;     // + = moved up (rank number went down)
  points_now: number | null;
  points_prev: number | null;
  d_points: number | null;   // + = improved
  is_new: boolean;
  cat: { sales: [number | null, number | null]; fc: [number | null, number | null]; labor: [number | null, number | null]; fin: [number | null, number | null]; ops: [number | null, number | null] };
}
export interface MoversResponse {
  scope: RankScope;
  tier: RankTier;
  current: MoverRun | null;
  previous: MoverRun | null;
  rows: MoverRow[];
}
export function fetchRankingMovers(scope: RankScope, tier: RankTier): Promise<MoversResponse> {
  return req(`${FN}?action=movers&scope=${scope}&tier=${tier}`);
}

// "7 UP in Sales" — top stores (or DOs) by sales vs last year for a scope.
export interface SevenUpRow {
  store_number: string;
  name?: string | null;   // DO name (tier=do)
  location: string | null;
  gm: string | null;
  do_name: string | null;
  sdo_name: string | null;
  sales: number | null;
  ly_sales: number | null;
  pct_vs_ly: number | null;
}
export interface SevenUpResponse {
  run: { period: number; week: number | null; week_ending: string | null } | null;
  scope: RankScope;
  tier?: "store" | "do";
  source?: "official" | "run";
  rows: SevenUpRow[];
}
export function fetchSevenUp(scope: RankScope, limit = 7, tier: "store" | "do" = "store"): Promise<SevenUpResponse> {
  return req(`${FN}?action=sevenup&scope=${scope}&limit=${limit}&tier=${tier}`);
}

// Evening-daypart sales growth vs last year (period-to-date), top stores.
// Shares the SevenUpRow shape (sales = Evening net, ly_sales = Evening prior year).
export interface EveningResponse {
  as_of: string | null;      // period-ending date when anchored, else snapshot date
  period?: number | null;    // fiscal period the numbers cover
  anchored?: boolean;        // true = completed period-end snapshot; false = latest (in-progress)
  daypart: string;
  source?: string;
  rows: SevenUpRow[];
}
export function fetchEveningGrowth(limit = 10): Promise<EveningResponse> {
  return req(`${FN}?action=evening-growth&limit=${limit}`);
}

// "Movers & Shakers" — biggest climbers in period rank vs the prior period.
export type MoverTier = "store" | "do" | "sdo" | "rvp";
export interface PeriodMoverRow {
  store_number: string;      // store # (store tier) or a leader join-key (leader tiers)
  name?: string | null;      // DO / SDO / RVP display name (leader tiers)
  location: string | null;
  gm: string | null;
  do_name: string | null;
  sdo_name: string | null;
  rank: number | null;       // current period rank
  prev_rank: number | null;  // last period's rank
  delta: number | null;      // + = spots gained
}
export interface PeriodMoversResponse {
  current: { period: number; week: number | null; week_ending: string | null } | null;
  previous: { period: number } | null;
  tier?: MoverTier;
  source?: "official" | "run";
  rows: PeriodMoverRow[];
}
export function fetchPeriodMovers(limit = 11, tier: MoverTier = "store"): Promise<PeriodMoversResponse> {
  return req(`${FN}?action=period-movers&limit=${limit}&tier=${tier}`);
}

// "Top Performers" — leaderboard (by rank) for the newest period: top stores + top DOs.
export interface TopStoreRow {
  rank: number | null;
  store_number: string;
  location: string | null;
  gm: string | null;
  do_name: string | null;
  sdo_name: string | null;
  total_points: number | null;
}
export interface TopDoRow {
  rank: number | null;
  name: string | null;
  sdo_name: string | null;
  total_points: number | null;
}
export interface TopPerformersResponse {
  period: number | null;
  source?: "official" | "run" | null;
  stores: TopStoreRow[];
  dos: TopDoRow[];
}
export function fetchTopPerformers(storeLimit = 20, doLimit = 10): Promise<TopPerformersResponse> {
  return req(`${FN}?action=top-performers&store_limit=${storeLimit}&do_limit=${doLimit}`);
}

// Official "SOAR PTD RANKING" sheet upload — archives the store tier's exact
// period-ending ranks / % vs LY, which 7 UP + Movers & Shakers then read.
export interface PtdRankingRowInput {
  soar_rank: number | null;
  store_code: string;
  location?: string | null;
  gm?: string | null;
  total_points?: number | null;
  ptd_sales?: number | null;
  ly_sales?: number | null;
  pct_vs_ly?: number | null;
}
export interface PtdLeaderRowInput {
  tier: string;              // 'do' | 'sdo' | 'rvp'
  entity_name: string;
  sdo_name?: string | null;
  store_count?: number | null;
  rank?: number | null;
  total_points?: number | null;
  ptd_sales?: number | null;
  ly_sales?: number | null;
}
export function ingestPtdRankingRows(input: {
  filename: string; period: number; rows: PtdRankingRowInput[]; leaders?: PtdLeaderRowInput[];
}): Promise<{ period: number; stores: number; leaders?: number }> {
  return req(`${FN}?action=ingest-ptd-ranking`, { method: "POST", body: JSON.stringify(input) });
}

// Communication Board — read-only mirror of the in-store weekly comms board.
export interface CommsStoreOption { number: string; name: string | null }
export interface CommsWeek { week: number; week_ending: string; metrics: RankMetrics | null }
export interface CommsRanks {
  company?: number | null; company_of?: number | null;
  region?: number | null; region_of?: number | null; region_name?: string | null;
}
export interface CommsBoardResponse {
  periods: number[];
  period: number | null;
  week_ending: string | null;
  stores: CommsStoreOption[];
  store: { number: string; location: string | null; gm: string | null; region: string | null; area: string | null; district: string | null } | null;
  weeks: CommsWeek[];
  ptd: RankMetrics | null;
  ranks: CommsRanks;
}
export function fetchCommsBoard(opts: { store?: string | null; period?: number | null }): Promise<CommsBoardResponse> {
  const p = new URLSearchParams({ action: "comms-board" });
  if (opts.store) p.set("store", opts.store);
  if (opts.period != null) p.set("period", String(opts.period));
  return req(`${FN}?${p.toString()}`);
}

export type FullRunScope = Partial<Record<RankTier, RankingResultRow[]>>;
export function fetchRankingFull(runId?: string | null): Promise<{
  run: RankingRun | null;
  scopes: { ptd: FullRunScope; wtd: FullRunScope };
}> {
  const p = new URLSearchParams({ action: "run-full" });
  if (runId) p.set("run_id", runId);
  return req(`${FN}?${p.toString()}`);
}

// Run the latest completed week, or (weekEnding given) re-run a specific past
// week — used by Refresh to recompute a week with the latest credits/data.
export function triggerRankingRun(weekEnding?: string): Promise<{ run_id: string; week_ending: string; period: number; week: number; rows: number; issues: RankingIssue[] }> {
  return req(`${FN}?action=run-now`, { method: "POST", body: JSON.stringify(weekEnding ? { week_ending: weekEnding } : {}) });
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

// ── Year-in-Review Awards ─────────────────────────────────────────────
export interface AwardStoreRow {
  store_number: string;
  location: string | null;
  gm: string | null;
  periods_in: number;
  avg_rank: number | null;
  best_rank: number | null;
  top1_count: number;
  top5_count: number;
  best_pct: number | null;
  best_pct_period: number | null;
  latest_sales: number | null;
  rank_first: number | null;
  rank_last: number | null;
  rank_delta: number | null;
  latest_period: number;
}
export interface AwardLeaderRow {
  name: string;
  sdo_name: string | null;
  periods_in: number;
  avg_rank: number | null;
  best_rank: number | null;
  rank_first: number | null;
  rank_last: number | null;
  rank_delta: number | null;
  best_points: number | null;
  latest_period: number;
}
export interface AwardCategory<T> {
  id: string;
  label: string;
  description: string;
  icon: string;
  podium: T[];
  sort_note: string;
}
export interface AwardsResponse {
  periods: number[];
  store_awards: AwardCategory<AwardStoreRow>[];
  leader_awards: AwardCategory<AwardLeaderRow>[];
  error: string | null;
}
export function fetchAwards(): Promise<AwardsResponse> {
  return req(`${FN}?action=awards`);
}

// ── Source ingestion ─────────────────────────────────────────────────

// Post an ingest; if the backend blocks it as an already-ingested duplicate,
// offer to re-ingest anyway (replaces the earlier upload) — the override for
// when the wrong file was uploaded and needs redoing. Admin-only endpoints.
async function ingestReq<T>(action: string, input: object): Promise<T> {
  try {
    return await req<T>(`${FN}?action=${action}`, { method: "POST", body: JSON.stringify(input) });
  } catch (e) {
    if (
      e instanceof Error && /already ingested/i.test(e.message) &&
      typeof window !== "undefined" &&
      window.confirm(`${e.message}\n\nRe-ingest anyway and replace the earlier upload?`)
    ) {
      return await req<T>(`${FN}?action=${action}`, { method: "POST", body: JSON.stringify({ ...input, force: true }) });
    }
    throw e;
  }
}

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
  return ingestReq("ingest-ix", input);
}

export interface TotzoneRowInput {
  store_code: string;
  store_name?: string | null;
  do_name?: string | null;
  sdo_name?: string | null;
  crew_pct?: number | null;
  manager_pct?: number | null;
  total_training_pct: number | null;
  tr_vs_tz?: number | null;
}

export function ingestTotzoneRows(input: {
  filename: string; sha256: string; as_of: string | null; rows: TotzoneRowInput[];
}): Promise<{ file_id: string; as_of: string | null; rows: number; stores: number; unresolved: string[] }> {
  return ingestReq("ingest-totzone", input);
}

export interface EcosureRowInput {
  store_code: string;
  store_name?: string | null;
  assessment_type?: string | null;
  date?: string | null;
  score: number | null;
  rating?: string | null;
}

export function ingestEcosureRows(input: {
  filename: string; sha256: string; as_of: string | null; rows: EcosureRowInput[];
}): Promise<{ file_id: string; as_of: string | null; rows: number; stores: number; unresolved: string[] }> {
  return ingestReq("ingest-ecosure", input);
}

export interface BscRowInput {
  store_code: string;
  store_name?: string | null;
  do_name?: string | null;
  sdo_name?: string | null;
  bsc_pct: number | null;
}

export function ingestBscRows(input: {
  filename: string; sha256: string; as_of: string | null; rows: BscRowInput[];
}): Promise<{ file_id: string; as_of: string | null; rows: number; stores: number; unresolved: string[] }> {
  return ingestReq("ingest-bsc", input);
}

export interface ShopRowInput {
  store_code: string;
  store_name?: string | null;
  visit_date: string | null;
  score: number | null;
}

export function ingestShopRows(input: {
  filename: string; sha256: string; rows: ShopRowInput[];
}): Promise<{ file_id: string; as_of: string | null; rows: number; stores: number; unresolved: string[] }> {
  return ingestReq("ingest-shops", input);
}

export interface VogRowInput {
  store_code: string;
  l2r: number | null;
  count: number | null;
  osat?: number | null;
}

export function ingestVogRows(input: {
  filename: string; sha256: string; scope: RankScope; rows: VogRowInput[];
}): Promise<{ file_id: string; scope: RankScope; rows: number; stores: number; unresolved: string[] }> {
  return ingestReq("ingest-vog", input);
}

export interface OttRowInput {
  store_code: string;
  on_time_pct: number | null;
  avg_sos: string | null;
  late_sends_pct: number | null;
  late_sends_count: number | null;
}
export function ingestOttRows(input: {
  filename: string; sha256: string; scope: RankScope; rows: OttRowInput[];
}): Promise<{ file_id: string; scope: RankScope; rows: number; stores: number; unresolved: string[] }> {
  return ingestReq("ingest-ott", input);
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

// ── Comms Board editable meta fields ────────────────────────────────────────
export type CommMetaField =
  | "employee_of_month"
  | "new_team_members"
  | "birthdays_this_month"
  | "current_promotions"
  | "top_3_food_variances";

export type CommsMeta = Partial<Record<CommMetaField, string>>;

export async function fetchCommsMeta(store: string, period: number): Promise<CommsMeta> {
  const { data, error } = await supabase
    .from("comms_board_meta")
    .select("field, value")
    .eq("store_number", store)
    .eq("period", period);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.field, r.value ?? ""])) as CommsMeta;
}

export async function saveCommsMeta(
  store: string,
  period: number,
  field: CommMetaField,
  value: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("comms_board_meta").upsert(
    { store_number: store, period, field, value, updated_by: user?.id, updated_at: new Date().toISOString() },
    { onConflict: "store_number,period,field" },
  );
  if (error) throw error;
}

// ── P1–P10 Cowork export ─────────────────────────────────────────────────────
export interface P110PeriodSlice {
  rank: number | null;
  total_points: number | null;
  ptd_sales: number | null;
  ly_sales: number | null;
  pct_vs_ly: number | null;
}
export interface P110StoreRow {
  store_number: string;
  location: string | null;
  gm: string | null;
  by_period: Record<number, P110PeriodSlice>;
  ytd: {
    periods_in: number;
    avg_rank: number | null;
    best_rank: number | null;
    rank_first: number | null;
    rank_last: number | null;
    rank_delta: number | null;
    avg_pct_vs_ly: number | null;
    total_sales: number | null;
  };
}
export interface P110LeaderPeriodSlice {
  rank: number | null;
  total_points: number | null;
  ptd_sales: number | null;
  ly_sales: number | null;
}
export interface P110LeaderRow {
  name: string;
  sdo_name: string | null;
  by_period: Record<number, P110LeaderPeriodSlice>;
  ytd: {
    periods_in: number;
    avg_rank: number | null;
    best_rank: number | null;
    rank_first: number | null;
    rank_last: number | null;
    rank_delta: number | null;
  };
}
export interface P110Company {
  store_count: number;
  do_count: number;
  total_sales: number | null;
  avg_rank: number | null;
  avg_pct_vs_ly: number | null;
  avg_rank_by_period: Record<number, number | null>;
  avg_pct_by_period: Record<number, number | null>;
}
export interface P110ExportResponse {
  periods: number[];
  stores: P110StoreRow[];
  leaders: P110LeaderRow[];
  company: P110Company | null;
  error: string | null;
}

export function fetchP110Export(from = 1, to = 13): Promise<P110ExportResponse> {
  return req(`${FN}?action=p1-p10-export&from=${from}&to=${to}`);
}

// ── Full metrics flat-row export ──────────────────────────────────────────────
export interface FullMetricsExportRow {
  period: number;
  week: number | null;
  week_ending: string | null;
  source: "run" | "official";
  rank: number | null;
  total_points: number | null;
  store: string;
  location: string | null;
  gm: string | null;
  do_name: string | null;
  sdo_name: string | null;
  // Sales
  ptd_sales: number | null;
  ly_sales: number | null;
  pct_vs_ly: number | null;
  tickets: number | null;
  tickets_vs_ly_pct: number | null;
  sales_score: number | null;
  // Food cost
  cogs_eff: number | null;
  fc_miss: number | null;
  fc_annualized: number | null;
  fc_score: number | null;
  // Labor
  labor_pct: number | null;
  labor_chart: number | null;
  labor_variance: number | null;
  labor_miss: number | null;
  labor_score: number | null;
  // Ops
  on_time_pct: number | null;
  on_time_score: number | null;
  calls_per_10k: number | null;
  complaints_score: number | null;
  vog_raw: number | null;
  vog_score: number | null;
  ecosure_score: number | null;
  bsc_score: number | null;
  total_training_pct: number | null;
  total_training_score: number | null;
  // Roll-up scores
  fin_score: number | null;
  ops_score: number | null;
  // Info-only
  voids: number | null;
  voids_pct: number | null;
  cash_over_short: number | null;
  doh: number | null;
  ms_count: number | null;
  ms_score: number | null;
  tr_vs_tz: number | null;
  evening_pct: number | null;
}

export interface FullMetricsExportResponse {
  periods: number[];
  rows: FullMetricsExportRow[];
  error: string | null;
}

export function fetchFullMetricsExport(from = 1, to = 13): Promise<FullMetricsExportResponse> {
  return req(`${FN}?action=full-metrics-export&from=${from}&to=${to}`);
}
