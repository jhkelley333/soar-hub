// Next Level Assessment (NLA) — shared types (mirror netlify/functions/nla.js).

export type Rating = "M" | "A" | "O";
export type RaterRole = "self" | "leader" | null;

export interface NlaTemplate {
  id: string;
  target_role: string;
  version: number;
  title: string;
}
export interface NlaTemplateItem {
  id: string;
  category: string;
  sort_order: number;
  competency_key: string;
  name: string;
  description: string | null;
  example: string | null;
}
export interface NlaRatingRow {
  competency_key: string;
  rating: Rating;
  note: string | null;
}
export interface NlaListRow {
  id: string;
  status: string;
  target_role: string;
  subject_name: string;
  leader_name: string;
  my_role: RaterRole;
  my_submitted: boolean;
  both_submitted: boolean;
  created_at: string;
}
export interface NlaGetResponse {
  assessment: {
    id: string;
    status: string;
    target_role: string;
    subject_name: string;
    leader_name: string;
    opened_at: string;
    comparison_ready_at: string | null;
  };
  template: NlaTemplate | null;
  items: NlaTemplateItem[];
  my_role: RaterRole;
  my_response: { id: string; submitted_at: string | null; locked: boolean } | null;
  my_ratings: NlaRatingRow[];
  both_submitted: boolean;
  counterpart_submitted: boolean;
}

export const RATING_META: Record<Rating, { label: string; hint: string }> = {
  M: { label: "Modeling", hint: "Consistently role-models this; others learn from them." },
  A: { label: "Aspiring", hint: "Demonstrates it, still building consistency." },
  O: { label: "Opportunity", hint: "A development area to grow into." },
};
export const RATING_ORDER: Rating[] = ["M", "A", "O"];

// ── Compare + align ──────────────────────────────────────────────────────────
export type GapType = "aligned" | "blind_spot" | "confidence_gap" | "incomplete";
export interface ComparisonRow {
  competency_key: string;
  name: string;
  category: string;
  sort_order: number;
  self_rating: Rating | null;
  leader_rating: Rating | null;
  delta: number | null;
  gap_type: GapType;
}
export interface FocusArea {
  competency_key: string;
  gap_type: string | null;
  note: string | null;
  suggested_resource: string | null;
  sort_order: number;
}
export interface NlaComparison {
  assessment: {
    id: string;
    status: string;
    target_role: string;
    subject_name: string;
    leader_name: string;
    comparison_ready_at: string | null;
    acknowledged_at: string | null;
  };
  rows: ComparisonRow[];
  summary: { aligned: number; blind_spot: number; confidence_gap: number };
  focus_areas: FocusArea[];
  can_edit: boolean;
  locked: boolean;
}
export const GAP_META: Record<"aligned" | "blind_spot" | "confidence_gap", { label: string; color: string; chip: string }> = {
  aligned:        { label: "Aligned",         color: "#10b981", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  blind_spot:     { label: "Blind spot",      color: "#f59e0b", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  confidence_gap: { label: "Confidence gap",  color: "#0ea5e9", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
};
// Left to right on the gap track: Opportunity -> Aspiring -> Modeling.
export const RATING_SCORE: Record<Rating, number> = { O: 1, A: 2, M: 3 };

// ── Acknowledge + plan ───────────────────────────────────────────────────────
export interface NlaAcks {
  acks: { user_id: string; ack_role: string; acknowledged_at: string }[];
  subject_acked: boolean;
  leader_acked: boolean;
  my_acked: boolean;
  status: string;
}
export interface PlanMilestone { title: string; due_date: string; status: string; sort_order: number }
export interface PlanGoal { focus_area: string; goal: string | null; status: string; milestones: PlanMilestone[] }
export interface NlaPlan { goals: PlanGoal[] }
export const READINESS_BAND_META: Record<string, { label: string; chip: string }> = {
  ready_now: { label: "Ready now", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  ready_soon: { label: "Ready soon", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  developing: { label: "Developing", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};

export const NLA_STATUS_META: Record<string, { label: string; chip: string }> = {
  awaiting_responses: { label: "Awaiting responses", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  both_submitted: { label: "Ready to compare", chip: "bg-blue-50 text-blue-700 ring-blue-200" },
  aligned: { label: "Aligned", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  acknowledged: { label: "Acknowledged", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  archived: { label: "Archived", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};
