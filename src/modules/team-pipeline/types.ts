// Team Pipeline — shared types (mirror team-pipeline.js + tp_* tables).

export type LadderKey = "carhop" | "crew" | "lead" | "shift" | "assoc" | "fam" | "gm";
export type FlightRisk = "na" | "low" | "medium" | "immediate";
export type Aspiration = "current" | "next" | "looking";
export type MemberStatus = "active" | "loa";

export interface RiskCounts { immediate: number; medium: number; low: number; na: number }

export interface StoreRollup {
  risk: RiskCounts;
  roster: number;
  open_reqs: number;
  gm_risk: FlightRisk | null;
}
export interface RollupResponse {
  stores: Record<string, StoreRollup>; // keyed by store id
  can_write: boolean;
  role_edit: boolean;
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
  reqs: Requisition[];
  can_write: boolean;
  role_edit: boolean; // role promote/demote toggle (Admin → Feature Flags)
}

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

// Preset flight-risk drivers (toggle chips); freeform notes go in the thread.
export const RISK_REASONS = ["Pay", "Commute", "Growth", "Manager fit", "Schedule", "Personal"];

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
