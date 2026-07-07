// Team Pipeline — shared types (mirror team-pipeline.js + tp_* tables).

export type LadderKey = "carhop" | "crew" | "lead" | "shift" | "assoc" | "fam" | "gm";
export type FlightRisk = "na" | "low" | "medium" | "immediate";
export type Aspiration = "current" | "next" | "looking";
export type MemberStatus = "active" | "loa" | "terminated";

export interface RiskCounts { immediate: number; medium: number; low: number; na: number }

export interface StoreRollup {
  risk: RiskCounts;
  roster: number;
  non_gm: number;
  open_reqs: number;
  gm_risk: FlightRisk | null;
  sales: number | null;   // latest weekly sales (Ranker), null if unavailable
  target: number | null;  // team members needed, excl GM = ceil(sales / divisor)
}
export interface RollupResponse {
  stores: Record<string, StoreRollup>; // keyed by store id
  can_write: boolean;
  role_edit: boolean;
  sales_per_member: number;
}

export interface TeamMember {
  id: string;
  store_id: string;
  profile_id: string | null;
  external_id: string | null;
  full_name: string;
  role: LadderKey;
  email: string | null;
  phone: string | null;
  status: MemberStatus;
  hire_date: string | null;
  flight_risk: FlightRisk;
  risk_reasons: string[];
  aspiration: Aspiration;
  perf: number | null;
  potential: number | null;
  comment: string | null;
  comment_by: string | null;
  backfill: string | null;
  created_at: string;
  updated_at: string;
  has_account?: boolean; // linked to an active app profile (server-computed)
}

// Crew Leader and up can be invited to an app login.
export const INVITE_ROLES: LadderKey[] = ["lead", "shift", "assoc", "fam", "gm"];

export interface GmsResponse { gms: TeamMember[] }

// ── Succession & Risk roll-up ────────────────────────────────────────
export interface AtRiskMember {
  member_id: string;
  name: string;
  store_id: string;
  store_number: string | null;
  store_name: string | null;
  district_id: string | null;
  role: LadderKey;
  risk: FlightRisk;
  reasons: string[];
  aspiration: Aspiration;
  perf: number | null;
  potential: number | null;
  tenure_days: number | null;
  cap_level: "verbal" | "written" | "final" | "pip" | null;
  backfill: string | null;
}
export type SeatStatus = "ok" | "at_risk" | "open";
export type Readiness = "now" | "6mo" | "12mo";
export type SeatCoverage = "ok" | "ready" | "developing" | "exposed";
export interface BenchEntry {
  id: string;
  successor_member_id: string | null;
  name: string;
  role: LadderKey | null;
  readiness: Readiness;
}
export interface GmSeat {
  store_id: string;
  store_number: string;
  store_name: string | null;
  district_id: string | null;
  gm_name: string | null;
  gm_id: string | null;
  gm_risk: FlightRisk | null;
  seat_status: SeatStatus;
  covered: boolean;
  coverage: SeatCoverage;
  readiness: Readiness | null;
  bench: BenchEntry[];
  backfill: string | null;
  req_status: string | null;
  plan: { type: "ready" | "develop" | "req" | "none"; detail: string } | null;
}
export interface SuccessionSummary {
  at_risk_immediate: number;
  at_risk_medium: number;
  at_risk_total: number;
  gm_total: number;
  gm_at_risk: number;
  gm_open: number;
  gm_ready: number;
  gm_developing: number;
  gm_covered: number;
  gm_exposed: number;
}

// A successor bench row (full detail, from the successors CRUD endpoint).
export interface Successor {
  id: string;
  incumbent_member_id: string;
  store_id: string;
  successor_member_id: string | null;
  successor_name: string | null;
  name: string;
  successor_role: LadderKey | null;
  successor_store_id: string | null;
  readiness: Readiness;
  rank: number;
  note: string | null;
}

export const READINESS_META: Record<Readiness, { label: string; short: string; chip: string }> = {
  now: { label: "Ready now", short: "Now", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  "6mo": { label: "Ready in ~6 months", short: "6 mo", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  "12mo": { label: "Ready in ~12 months", short: "12 mo", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};

export const SEAT_COVERAGE_META: Record<SeatCoverage, { label: string; chip: string }> = {
  ok: { label: "GM in place", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
  ready: { label: "Ready successor", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  developing: { label: "Developing", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  exposed: { label: "Exposed", chip: "bg-red-50 text-red-700 ring-red-200" },
};

// ── Quarterly calibration snapshots ──────────────────────────────────────────
export interface CalibrationSnapshot {
  period: string;                 // '2026-Q3'
  status: "open" | "locked";
  member_count: number;
  created_at: string;
  locked_at: string | null;
}
export interface SnapshotRow {
  member_id: string;
  store_id: string;
  role: LadderKey;
  perf: number | null;
  potential: number | null;
  flight_risk: FlightRisk;
  aspiration: Aspiration;
}

// ── Partner Development Plan (PDP) ────────────────────────────────────────────
export type DevItemStatus = "open" | "in_progress" | "done";
export interface DevPlan {
  id: string;
  member_id: string;
  store_id: string;
  target_role: string | null;
  target_date: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}
export interface DevItem {
  id: string;
  plan_id: string;
  store_id: string;
  focus_area: string;
  goal: string | null;
  actions: string | null;
  target_date: string | null;
  progress: string | null;
  status: DevItemStatus;
  rank: number;
  created_at: string;
  updated_at: string;
}
export const DEV_ITEM_META: Record<DevItemStatus, { label: string; chip: string }> = {
  open: { label: "Not started", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
  in_progress: { label: "In progress", chip: "bg-blue-50 text-blue-700 ring-blue-200" },
  done: { label: "Done", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

// ── Signal-assisted risk ──────────────────────────────────────────────────────
export type SignalSeverity = "watch" | "elevated";
export interface RiskSignal {
  key: string;
  severity: SignalSeverity;
  label: string;
  detail: string;
  implies: FlightRisk;
}
export interface MemberSignals {
  signals: RiskSignal[];
  suggested: FlightRisk;
  gap: boolean;
}
export interface RiskReviewRow {
  member_id: string;
  name: string;
  store_id: string;
  store_number: string | null;
  store_name: string | null;
  district_id: string | null;
  role: LadderKey;
  flight_risk: FlightRisk;
  suggested: FlightRisk;
  gap: boolean;
  top_signal: RiskSignal;
  signal_count: number;
  perf: number | null;
  potential: number | null;
  aspiration: Aspiration;
  hire_date: string | null;
}
export interface RiskReviewResponse {
  rows: RiskReviewRow[];
  summary: { total: number; gaps: number };
}
export const SIGNAL_SEVERITY_META: Record<SignalSeverity, { chip: string; dot: string }> = {
  elevated: { chip: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  watch: { chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
};
export interface SuccessionResponse {
  at_risk: AtRiskMember[];
  gm_seats: GmSeat[];
  summary: SuccessionSummary;
}

export interface Requisition {
  id: string;
  ref: string | null;
  store_id: string;
  role: LadderKey;
  reason: string | null;
  status: "sourcing" | "interviewing" | "offer" | "filled";
  candidates: number;
  opened_by: string | null;
  created_at: string;
}

export interface StoreRosterResponse {
  roster: TeamMember[];
  terminated: TeamMember[]; // out of the pipeline, kept for rehire/history
  reqs: Requisition[];
  can_write: boolean;
  role_edit: boolean; // role promote/demote toggle (Admin → Feature Flags)
  weekly_sales: number | null;
  sales_per_member: number;
  target: number | null; // team members needed, excl GM
}

export interface TpSettings {
  sales_per_member: number;
  can_edit: boolean;
}

// Performance / Potential rating ramp — red (low) → green (high).
export const RATING_COLOR: Record<number, { star: string; bg: string }> = {
  1: { star: "text-red-500", bg: "bg-red-100" },
  2: { star: "text-orange-500", bg: "bg-orange-100" },
  3: { star: "text-amber-500", bg: "bg-amber-100" },
  4: { star: "text-lime-600", bg: "bg-lime-100" },
  5: { star: "text-emerald-600", bg: "bg-emerald-100" },
};

export interface Note {
  id: string;
  team_member_id: string;
  body: string;
  author: string | null;
  author_id: string | null;
  created_at: string;
}

// Fields a viewer can edit from the profile drawer. `role` is only honored
// while the team_pipeline_role_edit flag is on (onboarding).
export type MemberPatch = Partial<{
  role: LadderKey;
  flight_risk: FlightRisk;
  aspiration: Aspiration;
  status: MemberStatus;
  perf: number | null;
  potential: number | null;
  backfill: string | null;
  risk_reasons: string[];
}>;

// Preset risk drivers (toggle chips); freeform notes go in the thread.
export const RISK_REASONS = ["Performance", "Pay", "Commute", "Growth", "Manager fit", "Schedule", "Personal"];

export const REQ_STATUS_META: Record<Requisition["status"], { label: string; chip: string }> = {
  sourcing: { label: "Sourcing", chip: "bg-zinc-100 text-zinc-600" },
  interviewing: { label: "Interviewing", chip: "bg-blue-50 text-blue-700" },
  offer: { label: "Offer out", chip: "bg-amber-50 text-amber-800" },
  filled: { label: "Filled", chip: "bg-emerald-50 text-emerald-700" },
};

// ── Corrective-action documents (progressive discipline) ──────────────────────
export type CaLevel = "verbal" | "written" | "final" | "pip";
export type CaStatus = "active" | "acknowledged" | "closed";

export interface CorrectiveAction {
  id: string;
  team_member_id: string;
  store_id: string;
  level: CaLevel;
  category: string | null;
  incident_date: string | null;
  summary: string;
  expectations: string | null;
  consequence: string | null;
  status: CaStatus;
  issued_by: string | null;
  issued_by_id: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
  updated_at: string;
}

export const CA_LEVELS: CaLevel[] = ["verbal", "written", "final", "pip"];
export const CA_LEVEL_META: Record<CaLevel, { label: string; short: string; chip: string }> = {
  verbal: { label: "Verbal warning", short: "Verbal", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  written: { label: "Written warning", short: "Written", chip: "bg-orange-50 text-orange-700 ring-orange-200" },
  final: { label: "Final written warning", short: "Final", chip: "bg-red-50 text-red-700 ring-red-200" },
  pip: { label: "Performance Improvement Plan", short: "PIP", chip: "bg-purple-50 text-purple-700 ring-purple-200" },
};
export const CA_STATUS_META: Record<CaStatus, { label: string; chip: string }> = {
  active: { label: "Active", chip: "bg-zinc-100 text-zinc-600" },
  acknowledged: { label: "Acknowledged", chip: "bg-blue-50 text-blue-700" },
  closed: { label: "Closed", chip: "bg-emerald-50 text-emerald-700" },
};
export const CA_CATEGORIES = ["Attendance", "Performance", "Conduct", "Policy", "Safety"];

// Per-level boilerplate that prefills the expectations + consequence fields.
export const CA_TEMPLATES: Record<CaLevel, { expectations: string; consequence: string }> = {
  verbal: {
    expectations: "Meet the expected standard going forward, effective immediately.",
    consequence: "Continued or repeated issues may result in a written warning.",
  },
  written: {
    expectations: "Immediate and sustained correction of the behavior described above.",
    consequence: "Further occurrences may lead to a final written warning.",
  },
  final: {
    expectations: "Immediate and sustained correction. No further occurrences will be tolerated.",
    consequence: "Any further occurrence may result in termination of employment.",
  },
  pip: {
    expectations: "Meet the measurable goals outlined in this plan within the review period.",
    consequence: "Failure to meet this plan may result in further action up to and including termination.",
  },
};

// Career ladder (bottom → top); `mgr` seats have named succession.
export const LADDER: { key: LadderKey; label: string; abbr: string; mgr: boolean }[] = [
  { key: "carhop", label: "Carhop", abbr: "CH", mgr: false },
  { key: "crew", label: "Crew Member", abbr: "CM", mgr: false },
  { key: "lead", label: "Crew Leader", abbr: "CL", mgr: false },
  { key: "shift", label: "Shift Manager", abbr: "SM", mgr: true },
  { key: "assoc", label: "Associate Manager", abbr: "AM", mgr: true },
  { key: "fam", label: "First Assistant Manager", abbr: "FAM", mgr: true },
  { key: "gm", label: "General Manager", abbr: "GM", mgr: true },
];
export const LADDER_BY_KEY = Object.fromEntries(LADDER.map((r) => [r.key, r])) as Record<LadderKey, (typeof LADDER)[number]>;

export const RISK_META: Record<FlightRisk, { label: string; short: string; chip: string; dot: string }> = {
  immediate: { label: "Immediate · 0–3 mo", short: "Immediate", chip: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  medium: { label: "Medium · 6–12 months", short: "Medium", chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  low: { label: "Low · 12+ months", short: "Low", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  na: { label: "Not assessed", short: "Not assessed", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200", dot: "bg-zinc-400" },
};

export const ASPIRATION_META: Record<Aspiration, { label: string; chip: string }> = {
  current: { label: "Current Role", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
  next: { label: "Next Level", chip: "bg-blue-50 text-blue-700 ring-blue-200" },
  looking: { label: "Looking", chip: "bg-red-50 text-red-700 ring-red-200" },
};

// Sales-tier headcount model. PLACEHOLDER numbers from the prototype — replace
// with the operator's real per-role/per-tier matrix. Until a real per-store tier
// source exists, every store is treated as DEFAULT_TIER.
export type Tier = "A" | "B" | "C" | "D";
export const TIERS: Record<Tier, { label: string; vol: string; rec: Record<LadderKey, number> }> = {
  A: { label: "Tier A", vol: "$60K+/wk", rec: { carhop: 14, crew: 10, lead: 4, shift: 4, assoc: 2, fam: 1, gm: 1 } },
  B: { label: "Tier B", vol: "$42–60K/wk", rec: { carhop: 11, crew: 8, lead: 3, shift: 3, assoc: 1, fam: 1, gm: 1 } },
  C: { label: "Tier C", vol: "$28–42K/wk", rec: { carhop: 8, crew: 6, lead: 2, shift: 2, assoc: 1, fam: 1, gm: 1 } },
  D: { label: "Tier D", vol: "<$28K/wk", rec: { carhop: 6, crew: 4, lead: 2, shift: 2, assoc: 0, fam: 1, gm: 1 } },
};
export const DEFAULT_TIER: Tier = "C";
export const roleBelow = (k: LadderKey): LadderKey | null => {
  const i = LADDER.findIndex((r) => r.key === k);
  return i > 0 ? LADDER[i - 1].key : null;
};

// Suggested distribution of the sales-driven total target across the non-GM
// roles (weights sum to 1). The store target itself comes from sales ÷ divisor;
// this is just a starting split for the per-role rows, and each row is still
// adjustable. GM is excluded (always its own seat).
const MIX_WEIGHTS: Record<Exclude<LadderKey, "gm">, number> = { carhop: 8, crew: 6, lead: 2, shift: 2, assoc: 1, fam: 1 };
const MIX_TOTAL = Object.values(MIX_WEIGHTS).reduce((a, b) => a + b, 0);
export const ROLE_MIX = Object.fromEntries(
  Object.entries(MIX_WEIGHTS).map(([k, v]) => [k, v / MIX_TOTAL]),
) as Record<Exclude<LadderKey, "gm">, number>;
