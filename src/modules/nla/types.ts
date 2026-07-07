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

export const NLA_STATUS_META: Record<string, { label: string; chip: string }> = {
  awaiting_responses: { label: "Awaiting responses", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  both_submitted: { label: "Ready to compare", chip: "bg-blue-50 text-blue-700 ring-blue-200" },
  aligned: { label: "Aligned", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  acknowledged: { label: "Acknowledged", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  archived: { label: "Archived", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};
