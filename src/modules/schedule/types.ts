// Schedule module — shared types (mirrors netlify/functions/schedule.js).

export type EventType =
  | "store_visit"
  | "audit"
  | "renovation"
  | "training"
  | "manager_meeting"
  | "pto"
  | "delivery"
  | "deadline"
  | "other";

export type ScopeType = "store" | "district" | "area" | "region" | "org";

export type EventSource = "soar" | "training" | "pto" | "walkthrough" | "reno";

export type Recurrence = "none" | "daily" | "weekly" | "biweekly" | "monthly";

export const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

export interface ScheduleEvent {
  id: string;
  source: EventSource;
  // Feed events (training/pto/…) are read-only here; clicking deep-links into
  // the source module instead of opening the editor.
  editable?: boolean;
  link?: string;
  title: string;
  type: EventType;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  scope_type: ScopeType;
  scope_id: string | null;
  store_number: string | null;
  notes: string | null;
  color: string | null;
  created_by_name: string | null;
  // Recurrence. A projected occurrence carries is_occurrence + series_start/
  // series_end (the master's true anchor); editing/deleting acts on the master
  // via `id`, which is the master's id on every occurrence.
  recurrence?: Recurrence;
  recurrence_until?: string | null;
  series_start?: string;
  series_end?: string | null;
  is_occurrence?: boolean;
}

export interface ScheduleListResponse {
  events: ScheduleEvent[];
  can_write: boolean;
}

export interface StorePick {
  id: string;
  number: string;
  name: string | null;
}
export interface DistrictGroup {
  district_id: string | null;
  district_name: string | null;
  district_code: string | null;
  area_id?: string | null;
  stores: StorePick[];
}
export interface AreaGroup {
  area_id: string | null;
  area_name: string | null;
  region_id?: string | null;
  districts: DistrictGroup[];
}
export interface RegionGroup {
  region_id: string | null;
  region_name: string | null;
  areas: AreaGroup[];
}
// Which org node is the viewer's own — gets the "YOU" badge in the tree.
export interface YouMarker {
  scope_type: "region" | "area" | "district" | "store" | "org" | null;
  scope_id: string | null;
}
export interface StoresResponse {
  districts: DistrictGroup[];
  tree: RegionGroup[];
  you?: YouMarker;
  can_org_wide: boolean;
  can_write: boolean;
}

export interface EventInput {
  id?: string;
  title: string;
  type: EventType;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean;
  scope_type: ScopeType;
  scope_id?: string | null;
  store_number?: string | null;
  notes?: string | null;
  color?: string | null;
  recurrence?: Recurrence;
  recurrence_until?: string | null;
}

// Per-type label + Tailwind palette (matches the design legend).
export const TYPE_META: Record<EventType, { label: string; dot: string; chip: string; bar: string }> = {
  store_visit:     { label: "Store visit",        dot: "bg-sky-500",     chip: "bg-sky-50 text-sky-700 ring-sky-200",        bar: "border-l-sky-500" },
  audit:           { label: "Audit / inspection", dot: "bg-rose-500",    chip: "bg-rose-50 text-rose-700 ring-rose-200",     bar: "border-l-rose-500" },
  renovation:      { label: "Renovation / scoping", dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700 ring-violet-200", bar: "border-l-violet-500" },
  training:        { label: "Training",           dot: "bg-teal-500",    chip: "bg-teal-50 text-teal-700 ring-teal-200",     bar: "border-l-teal-500" },
  manager_meeting: { label: "Manager meeting",    dot: "bg-slate-600",   chip: "bg-slate-100 text-slate-700 ring-slate-300", bar: "border-l-slate-600" },
  pto:             { label: "PTO / time-off",     dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "border-l-emerald-500" },
  delivery:        { label: "Delivery",           dot: "bg-amber-500",   chip: "bg-amber-50 text-amber-800 ring-amber-200",  bar: "border-l-amber-500" },
  deadline:        { label: "Deadline / compliance", dot: "bg-pink-500", chip: "bg-pink-50 text-pink-700 ring-pink-200",     bar: "border-l-pink-500" },
  other:           { label: "Other",              dot: "bg-zinc-400",    chip: "bg-zinc-100 text-zinc-600 ring-zinc-200",    bar: "border-l-zinc-400" },
};

export const EVENT_TYPE_ORDER: EventType[] = [
  "store_visit", "audit", "renovation", "training",
  "manager_meeting", "pto", "delivery", "deadline", "other",
];
