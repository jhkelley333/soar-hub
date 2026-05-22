// src/modules/workspaces/api.ts
//
// Typed wrappers around the four Workspace Netlify functions:
//   /.netlify/functions/workspaces            — workspaces, members,
//                                                templates, versions,
//                                                schedules, assignments,
//                                                activity log
//   /.netlify/functions/workspace-submissions — submissions, signoffs,
//                                                attachments, drafts
//   /.netlify/functions/workspace-caps        — CAPs, cap proofs,
//                                                repeat findings
//   /.netlify/functions/workspace-automations — automation CRUD
//
// Pattern mirrors src/modules/paf/api.ts.

import { supabase } from "@/lib/supabase";
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceTemplate,
  TemplateVersion,
  TemplateQuestion,
  TemplateApprovalStep,
  TemplateSection,
  WorkspaceSchedule,
  WorkspaceAssignment,
  WorkspaceSubmission,
  SubmissionAnswer,
  SubmissionSignoff,
  SubmissionDraft,
  CorrectiveActionPlan,
  CapProof,
  RepeatFinding,
  WorkspaceAutomation,
  WorkspaceAttachment,
  ActivityLogEntry,
} from "./types";

const FN_WS    = "/.netlify/functions/workspaces";
const FN_SUBS  = "/.netlify/functions/workspace-submissions";
const FN_CAPS  = "/.netlify/functions/workspace-caps";
const FN_AUTO  = "/.netlify/functions/workspace-automations";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(
  fn: string,
  action: string,
  init: RequestInit & { params?: Record<string, string | undefined> } = {},
): Promise<T> {
  const headers = { ...(await authHeaders()), ...(init.headers ?? {}) };
  const url = new URL(fn, window.location.origin);
  url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(init.params ?? {})) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers,
    body: init.body,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
      else if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const post = <T>(fn: string, action: string, body: unknown) =>
  request<T>(fn, action, { body: JSON.stringify(body), method: "POST" });

const get = <T>(fn: string, action: string, params?: Record<string, string | undefined>) =>
  request<T>(fn, action, { params });

// ═══════════════════════════════════════════════════════════
// WORKSPACES
// ═══════════════════════════════════════════════════════════

export function listWorkspaces(includeArchived = false) {
  return get<{ ok: true; workspaces: Workspace[] }>(
    FN_WS, "listMine",
    { include_archived: includeArchived ? "true" : undefined },
  );
}

export function getWorkspace(id: string) {
  return get<{
    ok: true;
    workspace: Workspace;
    members: WorkspaceMember[];
    my_workspace_role: string | null;
    my_is_admin: boolean;
  }>(FN_WS, "getWorkspace", { id });
}

export function createWorkspace(input: {
  name: string;
  description?: string;
  visibility?: "private" | "scoped" | "organization";
  scope_anchor_kind?: "region" | "area" | "district" | "store";
  scope_anchor_id?: string;
}) {
  return post<{ ok: true; workspace: Workspace }>(FN_WS, "createWorkspace", input);
}

export function updateWorkspace(input: {
  id: string;
  name?: string;
  description?: string | null;
  visibility?: "private" | "scoped" | "organization";
  scope_anchor_kind?: string | null;
  scope_anchor_id?: string | null;
}) {
  return post<{ ok: true; workspace: Workspace }>(FN_WS, "updateWorkspace", input);
}

export function archiveWorkspace(id: string) {
  return post<{ ok: true; workspace: Workspace }>(FN_WS, "archiveWorkspace", { id });
}

export function unarchiveWorkspace(id: string) {
  return post<{ ok: true; workspace: Workspace }>(FN_WS, "unarchiveWorkspace", { id });
}

export function deleteWorkspace(id: string) {
  return post<{ ok: true }>(FN_WS, "deleteWorkspace", { id });
}

// ── Members ──────────────────────────────────────────
export function listMembers(workspace_id: string) {
  return get<{ ok: true; members: WorkspaceMember[] }>(
    FN_WS, "listMembers", { workspace_id },
  );
}

export function addMember(input: {
  workspace_id: string;
  user_id: string;
  workspace_role: "owner" | "editor" | "submitter" | "viewer";
}) {
  return post<{ ok: true; member: WorkspaceMember }>(FN_WS, "addMember", input);
}

export function updateMember(input: {
  workspace_id: string;
  user_id: string;
  workspace_role: "owner" | "editor" | "submitter" | "viewer";
}) {
  return post<{ ok: true; member: WorkspaceMember }>(FN_WS, "updateMember", input);
}

export function removeMember(input: { workspace_id: string; user_id: string }) {
  return post<{ ok: true }>(FN_WS, "removeMember", input);
}

// ═══════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════

export function listTemplates(workspace_id: string, includeArchived = false) {
  return get<{ ok: true; templates: WorkspaceTemplate[] }>(
    FN_WS, "listTemplates",
    { workspace_id, include_archived: includeArchived ? "true" : undefined },
  );
}

export function getTemplate(id: string) {
  return get<{
    ok: true;
    template: WorkspaceTemplate;
    versions: TemplateVersion[];
    current_version_id: string | null;
    current_question_count: number;
  }>(FN_WS, "getTemplate", { id });
}

export function createTemplate(input: {
  workspace_id: string;
  name: string;
  description?: string;
  type?: "form" | "audit";
  audit_pass_threshold?: number;
  critical_fails_audit?: boolean;
}) {
  return post<{ ok: true; template: WorkspaceTemplate; version: TemplateVersion }>(
    FN_WS, "createTemplate", input,
  );
}

export function updateTemplate(input: {
  id: string;
  name?: string;
  description?: string | null;
  type?: "form" | "audit";
  audit_pass_threshold?: number | null;
  critical_fails_audit?: boolean;
}) {
  return post<{ ok: true; template: WorkspaceTemplate }>(FN_WS, "updateTemplate", input);
}

export function archiveTemplate(id: string) {
  return post<{ ok: true; template: WorkspaceTemplate }>(FN_WS, "archiveTemplate", { id });
}

// ── Template versions ─────────────────────────────────
export function getTemplateVersion(id: string) {
  return get<{
    ok: true;
    version: TemplateVersion & {
      workspace_templates?: WorkspaceTemplate;
    };
    questions: TemplateQuestion[];
    approval_steps: TemplateApprovalStep[];
    sections: TemplateSection[];
  }>(FN_WS, "getTemplateVersion", { id });
}

export function createTemplateVersion(template_id: string) {
  return post<{
    ok: true;
    version: TemplateVersion;
    forked_from_version_id: string | null;
  }>(FN_WS, "createTemplateVersion", { template_id });
}

export function publishTemplateVersion(id: string) {
  return post<{ ok: true; version: TemplateVersion }>(FN_WS, "publishTemplateVersion", { id });
}

export function upsertQuestions(version_id: string, questions: Partial<TemplateQuestion>[]) {
  return post<{ ok: true; questions: TemplateQuestion[] }>(
    FN_WS, "upsertQuestions", { version_id, questions },
  );
}

export function upsertApprovalSteps(
  version_id: string,
  approval_steps: Partial<TemplateApprovalStep>[],
) {
  return post<{ ok: true; approval_steps: TemplateApprovalStep[] }>(
    FN_WS, "upsertApprovalSteps", { version_id, approval_steps },
  );
}

// ═══════════════════════════════════════════════════════════
// SCHEDULES + ASSIGNMENTS
// ═══════════════════════════════════════════════════════════

export function listSchedules(workspace_id: string) {
  return get<{ ok: true; schedules: WorkspaceSchedule[] }>(
    FN_WS, "listSchedules", { workspace_id },
  );
}

export function createSchedule(input: Record<string, unknown>) {
  return post<{ ok: true; schedule: WorkspaceSchedule }>(FN_WS, "createSchedule", input);
}

export function updateSchedule(input: Record<string, unknown>) {
  return post<{ ok: true; schedule: WorkspaceSchedule }>(FN_WS, "updateSchedule", input);
}

export function toggleSchedule(id: string, is_active: boolean) {
  return post<{ ok: true; schedule: WorkspaceSchedule }>(
    FN_WS, "toggleSchedule", { id, is_active },
  );
}

export function deleteSchedule(id: string) {
  return post<{ ok: true }>(FN_WS, "deleteSchedule", { id });
}

export function listAssignments(input: {
  workspace_id: string;
  status?: string;
  assignee_id?: string;
}) {
  return get<{ ok: true; assignments: WorkspaceAssignment[] }>(
    FN_WS, "listAssignments", {
      workspace_id: input.workspace_id,
      status: input.status,
      assignee_id: input.assignee_id,
    },
  );
}

export function listMyAssignments(status?: string) {
  return get<{ ok: true; assignments: WorkspaceAssignment[] }>(
    FN_WS, "listMyAssignments", { status },
  );
}

export function getAssignment(id: string) {
  return get<{ ok: true; assignment: WorkspaceAssignment }>(FN_WS, "getAssignment", { id });
}

export function createAssignment(input: {
  workspace_id: string;
  template_id: string;
  assignee_id: string;
  store_id?: string;
  due_at?: string;
}) {
  return post<{ ok: true; assignment: WorkspaceAssignment }>(
    FN_WS, "createAssignment", input,
  );
}

export function startAssignment(id: string) {
  return post<{ ok: true; assignment: WorkspaceAssignment }>(FN_WS, "startAssignment", { id });
}

export function cancelAssignment(id: string, reason?: string) {
  return post<{ ok: true; assignment: WorkspaceAssignment }>(
    FN_WS, "cancelAssignment", { id, reason },
  );
}

// ═══════════════════════════════════════════════════════════
// SUBMISSIONS + SIGNOFFS + ATTACHMENTS + DRAFTS
// ═══════════════════════════════════════════════════════════

export function listSubmissions(input: {
  workspace_id: string;
  signoff_status?: string;
  submitter_id?: string;
}) {
  return get<{ ok: true; submissions: WorkspaceSubmission[] }>(
    FN_SUBS, "listSubmissions", input,
  );
}

export function getSubmission(id: string) {
  return get<{
    ok: true;
    submission: WorkspaceSubmission;
    answers: SubmissionAnswer[];
    signoffs: SubmissionSignoff[];
  }>(FN_SUBS, "getSubmission", { id });
}

export function createSubmission(input: {
  assignment_id: string;
  answers: Array<Partial<SubmissionAnswer> & { question_id: string }>;
}) {
  return post<{ ok: true; submission: WorkspaceSubmission }>(
    FN_SUBS, "createSubmission", input,
  );
}

export function createRevisionSubmission(input: {
  parent_submission_id: string;
  answers: Array<Partial<SubmissionAnswer> & { question_id: string }>;
  revision_reason?: string;
}) {
  return post<{ ok: true; submission: WorkspaceSubmission }>(
    FN_SUBS, "createRevisionSubmission", input,
  );
}

// ── Drafts ──────────────────────────────────────────
export function loadDraft(assignment_id: string) {
  return get<{ ok: true; draft: SubmissionDraft | null; stale: boolean }>(
    FN_SUBS, "loadDraft", { assignment_id },
  );
}

export function saveDraft(input: {
  assignment_id: string;
  template_version_id: string;
  answers: Array<Record<string, unknown>>;
  client_updated_at: string;
}) {
  return post<{ ok: true; draft?: SubmissionDraft; skipped?: boolean; reason?: string }>(
    FN_SUBS, "saveDraft", input,
  );
}

export function discardDraft(assignment_id: string) {
  return post<{ ok: true; attachments_deleted?: number }>(
    FN_SUBS, "discardDraft", { assignment_id },
  );
}

export function listMySignoffs() {
  return get<{ ok: true; signoffs: SubmissionSignoff[] }>(FN_SUBS, "listMySignoffs");
}

export function approveSignoff(signoff_id: string, notes?: string) {
  return post<{ ok: true; signoff: SubmissionSignoff; submission_status: string }>(
    FN_SUBS, "approveSignoff", { signoff_id, notes },
  );
}

export function rejectSignoff(signoff_id: string, notes: string) {
  return post<{ ok: true; signoff: SubmissionSignoff; submission_status: string }>(
    FN_SUBS, "rejectSignoff", { signoff_id, notes },
  );
}

export function requestRevision(signoff_id: string, notes: string) {
  return post<{ ok: true; signoff: SubmissionSignoff; submission_status: string }>(
    FN_SUBS, "requestRevision", { signoff_id, notes },
  );
}

// ── Attachments ──────────────────────────────────
export function createAttachment(input: {
  workspace_id: string;
  storage_path: string;
  file_name: string;
  file_size?: number;
  mime_type?: string;
  role?: string;
}) {
  return post<{ ok: true; attachment: WorkspaceAttachment }>(
    FN_SUBS, "createAttachment", input,
  );
}

// Upload + register an attachment in one shot. File bytes are sent as
// base64 inside the JSON body — direct client-to-storage uploads aren't
// possible on the workspace-attachments bucket (no INSERT policy).
export function uploadAttachment(input: {
  workspace_id: string;
  file_name: string;
  mime_type: string;
  file_data_base64: string;
  role?: string;
  captured_at?: string;
  geo_lat?: number;
  geo_lng?: number;
}) {
  return post<{ ok: true; attachment: WorkspaceAttachment }>(
    FN_SUBS, "uploadAttachment", input,
  );
}

export function deleteAttachment(id: string) {
  return post<{ ok: true }>(FN_SUBS, "deleteAttachment", { id });
}

export function getAttachmentSignedUrl(id: string, expires_in = 60) {
  return get<{ ok: true; signed_url: string; expires_in: number; attachment: WorkspaceAttachment }>(
    FN_SUBS, "getAttachmentSignedUrl", { id, expires_in: String(expires_in) },
  );
}

// ═══════════════════════════════════════════════════════════
// CAPS + REPEAT FINDINGS
// ═══════════════════════════════════════════════════════════

export function listCaps(input: {
  workspace_id: string;
  status?: string;
  assignee_id?: string;
  verifier_id?: string;
  store_id?: string;
}) {
  return get<{ ok: true; caps: CorrectiveActionPlan[] }>(FN_CAPS, "listCaps", input);
}

export function listMyCaps(includeClosed = false) {
  return get<{ ok: true; caps: CorrectiveActionPlan[] }>(
    FN_CAPS, "listMyCaps", { include_closed: includeClosed ? "true" : undefined },
  );
}

export function getCap(id: string) {
  return get<{ ok: true; cap: CorrectiveActionPlan; proofs: CapProof[] }>(
    FN_CAPS, "getCap", { id },
  );
}

export function startCap(id: string) {
  return post<{ ok: true; cap: CorrectiveActionPlan }>(FN_CAPS, "startCap", { id });
}

export function createCapProof(input: {
  cap_id: string;
  notes?: string;
  attachment_ids?: string[];
}) {
  return post<{ ok: true; proof: CapProof }>(FN_CAPS, "createCapProof", input);
}

export function verifyCapProof(input: {
  proof_id: string;
  accepted: boolean;
  verifier_notes?: string;
}) {
  return post<{ ok: true; proof: CapProof; cap_status: string }>(
    FN_CAPS, "verifyCapProof", input,
  );
}

export function listRepeatFindings(input: {
  workspace_id: string;
  unacknowledged?: boolean;
  store_id?: string;
}) {
  return get<{ ok: true; findings: RepeatFinding[] }>(
    FN_CAPS, "listRepeatFindings", {
      workspace_id: input.workspace_id,
      unacknowledged: input.unacknowledged ? "true" : undefined,
      store_id: input.store_id,
    },
  );
}

export function acknowledgeRepeatFinding(id: string, note?: string) {
  return post<{ ok: true; finding: RepeatFinding }>(
    FN_CAPS, "acknowledgeRepeatFinding", { id, acknowledged_note: note },
  );
}

// ═══════════════════════════════════════════════════════════
// AUTOMATIONS
// ═══════════════════════════════════════════════════════════

export function listAutomations(workspace_id: string) {
  return get<{ ok: true; automations: WorkspaceAutomation[] }>(
    FN_AUTO, "listAutomations", { workspace_id },
  );
}

export function getAutomation(id: string) {
  return get<{
    ok: true;
    automation: WorkspaceAutomation;
    recent_fires: Array<{
      id: string;
      created_at: string;
      event_data: Record<string, unknown> | null;
      actor_email: string | null;
    }>;
  }>(FN_AUTO, "getAutomation", { id });
}

export function createAutomation(input: {
  workspace_id: string;
  name: string;
  trigger: Record<string, unknown>;
  condition?: Record<string, unknown>;
  action: Record<string, unknown>;
  is_active?: boolean;
}) {
  return post<{ ok: true; automation: WorkspaceAutomation }>(
    FN_AUTO, "createAutomation", input,
  );
}

export function updateAutomation(input: Record<string, unknown> & { id: string }) {
  return post<{ ok: true; automation: WorkspaceAutomation }>(
    FN_AUTO, "updateAutomation", input,
  );
}

export function toggleAutomation(id: string, is_active: boolean) {
  return post<{ ok: true; automation: WorkspaceAutomation }>(
    FN_AUTO, "toggleAutomation", { id, is_active },
  );
}

export function deleteAutomation(id: string) {
  return post<{ ok: true }>(FN_AUTO, "deleteAutomation", { id });
}

export function runAutomationNow(id: string) {
  return post<{ ok: true; automation: WorkspaceAutomation; dry_run: boolean; message?: string }>(
    FN_AUTO, "runAutomationNow", { id },
  );
}

// ═══════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════

export function getActivity(input: { workspace_id: string; limit?: number; before?: string }) {
  return get<{ ok: true; entries: ActivityLogEntry[] }>(
    FN_WS, "getActivity",
    {
      workspace_id: input.workspace_id,
      limit: input.limit != null ? String(input.limit) : undefined,
      before: input.before,
    },
  );
}
