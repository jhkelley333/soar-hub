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
  created_at: string;
  updated_at: string;
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
  reqs: Requisition[];
  can_write: boolean;
}

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
