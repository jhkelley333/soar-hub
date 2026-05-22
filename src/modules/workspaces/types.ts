// src/modules/workspaces/types.ts
//
// TypeScript types for the Workspaces feature. Mirrors the schema
// from migrations 0058-0061 — snake_case columns kept as-is so the
// frontend uses backend rows directly without renaming.

// ── Workspaces ──────────────────────────────────────────────
export type WorkspaceVisibility = "private" | "scoped" | "organization";
export type WorkspaceScopeKind = "region" | "area" | "district" | "store";
export type WorkspaceRole = "owner" | "editor" | "submitter" | "viewer";

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  visibility: WorkspaceVisibility;
  scope_anchor_kind: WorkspaceScopeKind | null;
  scope_anchor_id: string | null;
  is_archived: boolean;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  workspace_role: WorkspaceRole;
  added_by_id: string | null;
  added_at: string;
  // Joined from profiles
  profiles?: {
    full_name: string | null;
    email: string | null;
    role: string | null;
  } | null;
}

// ── Templates ───────────────────────────────────────────────
export type TemplateType = "form" | "audit";
export type VersionStatus = "draft" | "published" | "archived";
export type FieldType =
  | "short_text" | "long_text" | "number"
  | "select_one" | "select_many"
  | "checkbox" | "date"
  | "photo" | "file"
  | "signature" | "pass_fail_na";

export interface WorkspaceTemplate {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  type: TemplateType;
  audit_pass_threshold: number | null;
  critical_fails_audit: boolean;
  is_archived: boolean;
  // Migration 0065: when true, any workspace member with
  // fill_assignment can self-start an assignment from this template
  // without it being pre-scheduled or hand-assigned.
  is_self_serve: boolean;
  created_by_id: string | null;
  created_at: string;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version_number: number;
  status: VersionStatus;
  published_at: string | null;
  created_by_id: string | null;
  created_at: string;
}

// Sections are first-class as of migration 0063 — they have their own
// position, label, and conditional_logic (show_if). Questions reference
// a section via section_id; section_label remains on the question as a
// display fallback and to keep the existing builder UI working
// unchanged (the backend auto-syncs section rows from section_label on
// upsertQuestions).
export interface TemplateSection {
  id: string;
  version_id: string;
  position: number;
  label: string;
  conditional_logic: Record<string, unknown> | null;
  created_at: string;
}

export interface TemplateQuestion {
  id: string;
  version_id: string;
  section_id: string | null;
  section_label: string | null;
  position: number;
  question_text: string;
  field_type: FieldType;
  is_required: boolean;
  weight: number | null;
  is_critical: boolean;
  requires_cap_on_fail: boolean;
  cap_assignee_rule: Record<string, unknown> | null;
  field_config: Record<string, unknown> | null;
  conditional_logic: Record<string, unknown> | null;
  created_at: string;
}

export interface TemplateApprovalStep {
  id: string;
  version_id: string;
  step_number: number;
  label: string;
  approver_rule: Record<string, unknown>;
  any_can_approve: boolean;
  created_at: string;
}

// ── Schedules + Assignments ─────────────────────────────────
export type Cadence = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly";

export interface WorkspaceSchedule {
  id: string;
  workspace_id: string;
  template_id: string;
  cadence: Cadence;
  day_of_week: number | null;
  day_of_month: number | null;
  spawn_time: string;
  spawn_tz: string;
  assignee_rule: Record<string, unknown>;
  due_after_hours: number;
  is_active: boolean;
  last_spawned_at: string | null;
  next_spawn_at: string | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export type AssignmentStatus =
  | "pending" | "in_progress" | "submitted" | "overdue" | "cancelled";

export interface WorkspaceAssignment {
  id: string;
  workspace_id: string;
  template_id: string;
  template_version_id: string;
  schedule_id: string | null;
  assignee_id: string;
  store_id: string | null;
  status: AssignmentStatus;
  due_at: string | null;
  started_at: string | null;
  cancelled_at: string | null;
  cancelled_by_id: string | null;
  created_by_id: string | null;
  created_at: string;
  // Optional joined data from list endpoints
  workspace_templates?: { id: string; name: string; type: TemplateType } | null;
  assignee?: { id: string; full_name: string | null; email: string | null; role: string | null } | null;
  store?: { id: string; store_number: string | null; name: string | null } | null;
  workspaces?: { id: string; name: string } | null;
}

// ── Submissions + Signoffs ──────────────────────────────────
export type SignoffStatus =
  | "pending_review" | "in_review" | "approved" | "rejected" | "revision_requested";
export type AuditOutcome = "pass" | "fail" | "fail_critical";
export type AuditResult = "pass" | "fail" | "na";
export type SignoffStepStatus = "pending" | "approved" | "rejected" | "skipped";

export interface WorkspaceSubmission {
  id: string;
  assignment_id: string;
  template_version_id: string;
  submitted_by_id: string | null;
  submitted_at: string;
  parent_submission_id: string | null;
  version_number: number;
  revision_reason: string | null;
  audit_score_total: number | null;
  audit_score_possible: number | null;
  audit_score_percent: number | null;
  audit_critical_failed: boolean | null;
  audit_outcome: AuditOutcome | null;
  signoff_status: SignoffStatus;
  is_locked: boolean;
}

export interface SubmissionAnswer {
  id: string;
  submission_id: string;
  question_id: string;
  answer_text: string | null;
  answer_number: number | null;
  answer_boolean: boolean | null;
  answer_date: string | null;
  answer_json: unknown | null;
  attachment_ids: string[] | null;
  audit_result: AuditResult | null;
  audit_was_critical: boolean | null;
  captured_at: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  created_at: string;
}

export interface SubmissionSignoff {
  id: string;
  submission_id: string;
  step_id: string;
  step_number: number;
  status: SignoffStepStatus;
  acted_by_id: string | null;
  acted_at: string | null;
  notes: string | null;
  candidate_user_ids: string[];
  created_at: string;
}

// In-progress autosaved answers (migration 0064). One row per
// (assignment, user); deleted by the backend on a successful submit.
export interface SubmissionDraft {
  id: string;
  assignment_id: string;
  template_version_id: string;
  user_id: string;
  answers: Array<Record<string, unknown>>;
  client_updated_at: string;
  last_saved_at: string;
  created_at: string;
}

// ── CAPs ────────────────────────────────────────────────────
export type CapStatus =
  | "open" | "in_progress" | "proof_submitted" | "verified" | "closed" | "reopened";
export type CapProofVerifiedStatus = "accepted" | "rejected" | null;

export interface CorrectiveActionPlan {
  id: string;
  workspace_id: string;
  submission_id: string;
  answer_id: string;
  question_id: string;
  store_id: string | null;
  assignee_id: string;
  verifier_id: string | null;
  due_at: string | null;
  status: CapStatus;
  template_instructions: string | null;
  failure_notes: string | null;
  verified_at: string | null;
  verified_by_id: string | null;
  reopened_count: number;
  last_reopened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapProof {
  id: string;
  cap_id: string;
  submitted_by_id: string | null;
  submitted_at: string;
  notes: string | null;
  attachment_ids: string[] | null;
  verified_status: CapProofVerifiedStatus;
  verified_at: string | null;
  verified_by_id: string | null;
  verifier_notes: string | null;
}

// ── Repeat findings ────────────────────────────────────────
export interface RepeatFinding {
  id: string;
  workspace_id: string;
  store_id: string;
  question_id: string;
  occurrences: Array<{
    submission_id: string;
    answer_id: string;
    failed_at: string;
    was_critical: boolean;
  }>;
  first_occurred_at: string;
  last_occurred_at: string;
  occurrence_count: number;
  acknowledged_at: string | null;
  acknowledged_by_id: string | null;
  acknowledged_note: string | null;
  created_at: string;
}

// ── Automations ────────────────────────────────────────────
export interface WorkspaceAutomation {
  id: string;
  workspace_id: string;
  name: string;
  trigger: Record<string, unknown>;
  condition: Record<string, unknown> | null;
  action: Record<string, unknown>;
  is_active: boolean;
  last_fired_at: string | null;
  fire_count: number;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Attachments ────────────────────────────────────────────
export interface WorkspaceAttachment {
  id: string;
  workspace_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  role: string | null;
  captured_at: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  uploaded_by_id: string | null;
  created_at: string;
}

// ── Activity log ───────────────────────────────────────────
export interface ActivityLogEntry {
  id: string;
  workspace_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  target_kind: string;
  target_id: string;
  action: string;
  event_data: Record<string, unknown> | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

// ── API response shapes ────────────────────────────────────
export interface OkResponse { ok: true }
export interface ErrorResponse { ok: false; message: string; error?: string }

// Discriminated union for safe parsing
export type ApiResponse<T> = (T & { ok: true }) | ErrorResponse;
