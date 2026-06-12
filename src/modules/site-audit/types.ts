// Site Audits (Audit Pro) — shared types (mirror site-audit.js).

export type Severity = "high" | "medium" | "low";
export type ProofKind = "photo" | "note";

export interface Completion {
  by: string;
  by_name: string;
  at: string;
  note: string | null;
  photo_url: string | null;
}

export interface AuditIssue {
  id: string;
  audit_id: string;
  title: string;
  area: string | null;
  severity: Severity;
  comment: string | null;
  photo_url: string | null;
  due: string | null;
  proof_required: ProofKind[];
  completed: boolean;
  completion: Completion | null;
  created_at: string;
}

export interface AuditStats {
  total: number;
  done: number;
  open: number;
  high: number;
  pct: number;
}

export interface SiteAudit {
  id: string;
  store_id: string;
  store_number: string;
  store_name: string | null;
  created_by_name: string | null;
  status: string;
  note: string | null;
  date: string;
  created_at: string;
  stats: AuditStats;
  issues: AuditIssue[];
}

export interface AuditsResponse {
  audits: SiteAudit[];
  can_write: boolean;
}

export interface StorePick {
  id: string;
  number: string;
  name: string | null;
}

export const AREAS = [
  "Exterior", "Entrance", "Sales Floor", "Restroom", "Stockroom",
  "Restaurant", "Kitchen", "Parking Lot", "General", "Other",
] as const;

export const SEVERITY_META: Record<Severity, { label: string; dot: string; chip: string; bar: string }> = {
  high:   { label: "High",   dot: "bg-red-500",   chip: "bg-red-50 text-red-700 ring-red-200",     bar: "border-l-red-500" },
  medium: { label: "Medium", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200", bar: "border-l-amber-500" },
  low:    { label: "Low",    dot: "bg-zinc-400",  chip: "bg-zinc-100 text-zinc-600 ring-zinc-200",  bar: "border-l-zinc-400" },
};
