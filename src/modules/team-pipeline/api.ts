// Typed wrappers around netlify/functions/team-pipeline.
import { supabase } from "@/lib/supabase";
import type {
  CalibrationSnapshot, CaLevel, CaStatus, CorrectiveAction, DevItem, DevItemStatus, DevPlan, DevRollupResponse,
  GmsResponse, MemberPatch, MemberSignals, Note, Readiness, Requisition, RiskReviewResponse, RollupResponse,
  MonthlyReviewResponse, SnapshotRow, StoreRosterResponse, Successor, SuccessionResponse, TalentExportResponse,
  TeamMember, TenureRollupResponse,
} from "./types";

const FN = "/.netlify/functions/team-pipeline";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchRollup(): Promise<RollupResponse> {
  return request<RollupResponse>(`${FN}?action=rollup`);
}
export function fetchSuccession(): Promise<SuccessionResponse> {
  return request<SuccessionResponse>(`${FN}?action=succession`);
}
export function fetchGms(): Promise<GmsResponse> {
  return request<GmsResponse>(`${FN}?action=gms`);
}
export function fetchStoreRoster(storeId: string): Promise<StoreRosterResponse> {
  return request<StoreRosterResponse>(`${FN}?action=store-roster&store_id=${encodeURIComponent(storeId)}`);
}
export function seedFromProfiles(): Promise<{ ok: true; created: number }> {
  return request(`${FN}?action=seed-from-profiles`, { method: "POST", body: "{}" });
}
export interface CommitPlanInput {
  store_id: string;
  hires: Record<string, number>;
  promotions: { member_id: string; to_role: string }[];
}
export function commitPlan(input: CommitPlanInput): Promise<{ ok: true; promoted: number; reqs_opened: number }> {
  return request(`${FN}?action=commit-plan`, { method: "POST", body: JSON.stringify(input) });
}
export function updateMember(memberId: string, patch: MemberPatch): Promise<{ ok: true; member: TeamMember }> {
  return request(`${FN}?action=update-member`, { method: "POST", body: JSON.stringify({ member_id: memberId, patch }) });
}
export function fetchNotes(memberId: string): Promise<{ notes: Note[] }> {
  return request(`${FN}?action=notes&member_id=${encodeURIComponent(memberId)}`);
}
export function addNote(memberId: string, body: string): Promise<{ ok: true; note: Note }> {
  return request(`${FN}?action=add-note`, { method: "POST", body: JSON.stringify({ member_id: memberId, body }) });
}
export function updateReq(reqId: string, patch: { status?: Requisition["status"]; candidates?: number }): Promise<{ ok: true; req: Requisition }> {
  return request(`${FN}?action=update-req`, { method: "POST", body: JSON.stringify({ req_id: reqId, ...patch }) });
}
export function fetchCorrectiveActions(memberId: string): Promise<{ actions: CorrectiveAction[] }> {
  return request(`${FN}?action=corrective-actions&member_id=${encodeURIComponent(memberId)}`);
}
export interface NewCorrectiveAction {
  level: CaLevel;
  category?: string | null;
  incident_date?: string | null;
  summary: string;
  expectations?: string | null;
  consequence?: string | null;
}
export function addCorrectiveAction(memberId: string, doc: NewCorrectiveAction): Promise<{ ok: true; action: CorrectiveAction }> {
  return request(`${FN}?action=add-corrective-action`, { method: "POST", body: JSON.stringify({ member_id: memberId, ...doc }) });
}
export function setCorrectiveActionStatus(actionId: string, status: CaStatus): Promise<{ ok: true; action: CorrectiveAction }> {
  return request(`${FN}?action=corrective-action-status`, { method: "POST", body: JSON.stringify({ action_id: actionId, status }) });
}

// ── Succession bench (ranked successors + readiness) ─────────────────────────
export function fetchSuccessors(memberId: string): Promise<{ successors: Successor[] }> {
  return request(`${FN}?action=successors&member_id=${encodeURIComponent(memberId)}`);
}
export interface NewSuccessor {
  successor_member_id?: string | null;
  successor_name?: string | null;
  readiness?: Readiness;
  note?: string | null;
}
export function addSuccessor(memberId: string, s: NewSuccessor): Promise<{ ok: true; successor: Successor }> {
  return request(`${FN}?action=add-successor`, { method: "POST", body: JSON.stringify({ member_id: memberId, ...s }) });
}
export function updateSuccessor(successorId: string, patch: Partial<{ readiness: Readiness; rank: number; note: string | null; successor_name: string | null }>): Promise<{ ok: true; successor: Successor }> {
  return request(`${FN}?action=update-successor`, { method: "POST", body: JSON.stringify({ successor_id: successorId, patch }) });
}
export function removeSuccessor(successorId: string): Promise<{ ok: true }> {
  return request(`${FN}?action=remove-successor`, { method: "POST", body: JSON.stringify({ successor_id: successorId }) });
}

// ── Quarterly calibration snapshots ──────────────────────────────────────────
export function fetchSnapshots(): Promise<{ snapshots: CalibrationSnapshot[]; can_manage: boolean }> {
  return request(`${FN}?action=snapshots`);
}
export function fetchSnapshotRows(period: string, storeId?: string): Promise<{ period: string; rows: SnapshotRow[] }> {
  const q = storeId ? `&store_id=${encodeURIComponent(storeId)}` : "";
  return request(`${FN}?action=snapshot-rows&period=${encodeURIComponent(period)}${q}`);
}
export function takeSnapshot(period: string): Promise<{ ok: true; period: string; member_count: number; replaced: boolean }> {
  return request(`${FN}?action=take-snapshot`, { method: "POST", body: JSON.stringify({ period }) });
}
export function lockSnapshot(period: string): Promise<{ ok: true; period: string; status: "locked" }> {
  return request(`${FN}?action=lock-snapshot`, { method: "POST", body: JSON.stringify({ period }) });
}

// ── Partner Development Plan (PDP) ────────────────────────────────────────────
export function fetchDevPlan(memberId: string): Promise<{ plan: DevPlan | null; items: DevItem[] }> {
  return request(`${FN}?action=dev-plan&member_id=${encodeURIComponent(memberId)}`);
}
export function saveDevPlan(memberId: string, patch: Partial<{ target_role: string | null; target_date: string | null }>): Promise<{ ok: true; plan: DevPlan }> {
  return request(`${FN}?action=save-dev-plan`, { method: "POST", body: JSON.stringify({ member_id: memberId, ...patch }) });
}
export interface NewDevItem {
  focus_area: string;
  goal?: string | null;
  actions?: string | null;
  target_date?: string | null;
  progress?: string | null;
}
export function addDevItem(memberId: string, item: NewDevItem): Promise<{ ok: true; item: DevItem }> {
  return request(`${FN}?action=add-dev-item`, { method: "POST", body: JSON.stringify({ member_id: memberId, ...item }) });
}
export function updateDevItem(itemId: string, patch: Partial<{ focus_area: string; goal: string | null; actions: string | null; target_date: string | null; progress: string | null; status: DevItemStatus; rank: number }>): Promise<{ ok: true; item: DevItem }> {
  return request(`${FN}?action=update-dev-item`, { method: "POST", body: JSON.stringify({ item_id: itemId, patch }) });
}
export function removeDevItem(itemId: string): Promise<{ ok: true }> {
  return request(`${FN}?action=remove-dev-item`, { method: "POST", body: JSON.stringify({ item_id: itemId }) });
}
export function addDevMilestone(itemId: string, m: { title: string; due_date?: string | null; description?: string | null }): Promise<{ ok: true; milestone: import("./types").DevMilestone }> {
  return request(`${FN}?action=add-dev-milestone`, { method: "POST", body: JSON.stringify({ item_id: itemId, ...m }) });
}
export function updateDevMilestone(milestoneId: string, patch: Partial<{ title: string; due_date: string | null; status: import("./types").MilestoneStatus; description: string | null }>): Promise<{ ok: true; milestone: import("./types").DevMilestone }> {
  return request(`${FN}?action=update-dev-milestone`, { method: "POST", body: JSON.stringify({ milestone_id: milestoneId, patch }) });
}
export function removeDevMilestone(milestoneId: string): Promise<{ ok: true }> {
  return request(`${FN}?action=remove-dev-milestone`, { method: "POST", body: JSON.stringify({ milestone_id: milestoneId }) });
}

// ── Signal-assisted risk ──────────────────────────────────────────────────────
export function fetchMemberSignals(memberId: string): Promise<MemberSignals> {
  return request(`${FN}?action=member-signals&member_id=${encodeURIComponent(memberId)}`);
}
export function fetchRiskReview(): Promise<RiskReviewResponse> {
  return request(`${FN}?action=risk-review`);
}

// ── PDP roll-up ────────────────────────────────────────────────────────────────
export function fetchDevRollup(): Promise<DevRollupResponse> {
  return request(`${FN}?action=dev-rollup`);
}

// ── Assessment readiness (from acknowledged NLAs) ─────────────────────────────
export function fetchReadinessRollup(): Promise<import("./types").ReadinessRollupResponse> {
  return request(`${FN}?action=readiness-rollup`);
}
export function fetchMemberReadiness(memberId: string): Promise<{ readiness: import("./types").MemberReadiness | null }> {
  return request(`${FN}?action=member-readiness&member_id=${encodeURIComponent(memberId)}`);
}

// ── Time-in-role dashboard ────────────────────────────────────────────────────
export function fetchTenureRollup(): Promise<TenureRollupResponse> {
  return request(`${FN}?action=tenure-rollup`);
}

// ── Talent review packet ──────────────────────────────────────────────────────
export function fetchTalentExport(districtId: string): Promise<TalentExportResponse> {
  return request(`${FN}?action=talent-export&district_id=${encodeURIComponent(districtId)}`);
}

// ── Monthly talent-review nudge ───────────────────────────────────────────────
export function fetchMonthlyReview(): Promise<MonthlyReviewResponse> {
  return request(`${FN}?action=monthly-review`);
}
export function markReviewed(note?: string): Promise<{ ok: true; period: string; reviewed_at: string }> {
  return request(`${FN}?action=mark-reviewed`, { method: "POST", body: JSON.stringify({ note: note ?? null }) });
}

// ATS roster import. Rows are the raw CSV cells; the backend resolves stores,
// maps roles, and dedupes.
export type ImportRowInput = Record<string, string>;
export interface ImportRowAnnotated {
  row: number;
  full_name: string;
  store_number: string;
  role: string | null;
  status: string;
  hire_date: string | null;
  email: string | null;
  phone: string | null;
  external_id: string | null;
  store_id: string | null;
  existing_id: string | null;
  action: "create" | "update" | "error";
  errors: string[];
  warnings: string[];
}
export interface ImportPreviewResponse {
  rows: ImportRowAnnotated[];
  summary: { create: number; update: number; error: number };
}
export type ImportMode = "all" | "new" | "update";
export interface ImportResultRow { row: number; status: "created" | "updated" | "skipped" | "error"; full_name: string; message?: string }
export interface ImportRosterResponse {
  ok: true;
  results: ImportResultRow[];
  summary: { created: number; updated: number; skipped: number; errors: number };
}
export function importPreview(rows: ImportRowInput[]): Promise<ImportPreviewResponse> {
  return request(`${FN}?action=import-preview`, { method: "POST", body: JSON.stringify({ rows }) });
}
export function importRoster(rows: ImportRowInput[], mode: ImportMode = "all"): Promise<ImportRosterResponse> {
  return request(`${FN}?action=import-roster`, { method: "POST", body: JSON.stringify({ rows, mode }) });
}
export function mergeMembers(keepId: string, dropId: string): Promise<{ ok: true; kept: string }> {
  return request(`${FN}?action=merge-members`, { method: "POST", body: JSON.stringify({ keep_id: keepId, drop_id: dropId }) });
}
export function inviteMember(memberId: string, email: string): Promise<{ ok: true; profile_id: string; email: string }> {
  return request(`${FN}?action=invite-member`, { method: "POST", body: JSON.stringify({ member_id: memberId, email }) });
}
export function fetchSettings(): Promise<import("./types").TpSettings> {
  return request(`${FN}?action=settings`);
}
export function updateSettings(salesPerMember: number): Promise<{ ok: true; sales_per_member: number }> {
  return request(`${FN}?action=update-settings`, { method: "POST", body: JSON.stringify({ sales_per_member: salesPerMember }) });
}
