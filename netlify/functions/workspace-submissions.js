// netlify/functions/workspace-submissions.js
//
// REST handler for the Workspace SUBMISSION layer. Split off from
// workspaces.js because that file was getting too large to push as a
// single change. The split is purely organizational — same auth
// pattern, same capability map, same DB.
//
// Actions covered:
//   submissions:  listSubmissions, getSubmission, createSubmission,
//                 createRevisionSubmission, unlockSubmission,
//                 relockSubmission
//   drafts:       loadDraft, saveDraft, discardDraft
//   signoffs:     approveSignoff, rejectSignoff, requestRevision,
//                 listMySignoffs
//   attachments:  listAttachments, createAttachment, uploadAttachment,
//                 deleteAttachment, getAttachmentSignedUrl
//
// Frontend calls /.netlify/functions/workspace-submissions?action=...
// (workspaces.js still handles all other actions at its own URL.)

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  isOrgAdmin,
  requireWorkspaceCap,
} from "./_lib/workspace_permissions.js";
import {
  resolveSignoffCandidates,
  computeAuditScoring,
  usersAtAnchorWithRole,
} from "./_lib/workspace_resolvers.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Max accepted upload size for uploadAttachment. After client-side
// compression a photo should be well under this; Netlify Functions
// allow ~6MB request bodies on the standard plan so we stay clear.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getCallerProfile(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = getSupabase();
  const { data: userRes } = await supa.auth.getUser(token);
  if (!userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function isUuid(s) {
  return typeof s === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// Same shape + intent as workspaces.js logActivity — duplicated here
// so this file is self-contained. Both writes target the same
// workspace_activity_log table with the same column conventions.
async function logActivity(supabase, profile, opts) {
  try {
    await supabase.from("workspace_activity_log").insert({
      workspace_id:  opts.workspaceId,
      actor_id:      profile?.id || null,
      actor_email:   profile?.email || null,
      actor_role:    profile?.role || null,
      target_kind:   opts.targetKind,
      target_id:     opts.targetId,
      action:        opts.action,
      event_data:    opts.eventData || null,
      before_state:  opts.beforeState || null,
      after_state:   opts.afterState || null,
    });
  } catch (err) {
    console.warn("workspace-submissions.logActivity failed:", err?.message || err);
  }
}

// Best-effort draft cleanup. Called after a submission is created. We
// don't error if the draft row doesn't exist — just means the user
// submitted from a fresh state with no autosave history.
async function deleteDraft(supabase, assignmentId, userId) {
  try {
    await supabase
      .from("workspace_submission_drafts")
      .delete()
      .eq("assignment_id", assignmentId)
      .eq("user_id", userId);
  } catch (err) {
    console.warn("workspace-submissions.deleteDraft failed:", err?.message || err);
  }
}

const ALLOWED_SIGNOFF_STATUS = [
  "pending_review", "in_review", "approved", "rejected", "revision_requested",
];
const ALLOWED_AUDIT_RESULT = ["pass", "fail", "na"];

// Default CAP due-window: 7 days from creation. Single knob if we ever
// want a per-template override.
const AUTO_CAP_DUE_DAYS = 7;

// Resolve question.cap_assignee_rule → a single user id. CAPs are 1:1
// with a person (unlike signoffs which can have a candidate pool), so
// this returns ONE id. Falls back to `fallbackUserId` (typically the
// submitter) if the rule can't be resolved to a real user.
//
// DSL kinds supported:
//   { kind: "fixed",          user_id }
//   { kind: "submitter" }            ← explicit "the submitter"
//   { kind: "role_relative",  role, anchor: "submission_store" }
//     (anchor="scope_anchor" not supported for CAPs — CAPs live at
//     the store level; the workspace anchor would be too coarse.)
async function resolveCapAssignee(supabase, rule, submissionStoreId, fallbackUserId) {
  if (!rule || typeof rule !== "object") return fallbackUserId;
  const kind = rule.kind;

  if (kind === "fixed" && isUuid(rule.user_id)) {
    return rule.user_id;
  }
  if (kind === "submitter") {
    return fallbackUserId;
  }
  if (kind === "role_relative" && rule.anchor === "submission_store" && submissionStoreId) {
    const users = await usersAtAnchorWithRole(supabase, "store", submissionStoreId, rule.role);
    if (users.length) return users[0]; // first match (stable enough for v1)
  }
  return fallbackUserId;
}

// Auto-create CAPs for any failed audit answer where the question has
// requires_cap_on_fail = true. Called after an audit submission's
// answers have been inserted. Best-effort: per-CAP failures are
// logged but don't abort the submission. The inline failure_notes
// captured on the answer (answer_text) get copied onto the CAP so the
// assignee can see exactly what was wrong without re-reading the form.
async function autoCreateCapsForAuditAnswers({
  supabase, profile, template, questions, insertedAnswers,
  workspace, assignment, submission,
}) {
  if (!template || template.type !== "audit") return { created: 0, ids: [] };
  if (!insertedAnswers?.length) return { created: 0, ids: [] };

  const qById = new Map((questions || []).map((q) => [q.id, q]));
  const created = [];

  for (const ans of insertedAnswers) {
    const q = qById.get(ans.question_id);
    if (!q) continue;
    if (q.field_type !== "pass_fail_na") continue;
    if (ans.audit_result !== "fail") continue;
    if (!q.requires_cap_on_fail) continue;

    try {
      const assigneeId = await resolveCapAssignee(
        supabase, q.cap_assignee_rule, assignment.store_id, profile.id,
      );
      const dueAt = new Date(
        Date.now() + AUTO_CAP_DUE_DAYS * 86_400_000,
      ).toISOString();

      const { data: cap, error } = await supabase
        .from("workspace_corrective_action_plans")
        .insert({
          workspace_id: assignment.workspace_id,
          submission_id: submission.id,
          answer_id: ans.id,
          question_id: q.id,
          store_id: assignment.store_id || null,
          assignee_id: assigneeId,
          status: "open",
          template_instructions: q.question_text,
          failure_notes: ans.answer_text || null,
          due_at: dueAt,
        })
        .select("*")
        .single();
      if (error) {
        console.warn("[workspace-submissions] auto-CAP insert failed:", error.message);
        continue;
      }

      await logActivity(supabase, profile, {
        workspaceId: assignment.workspace_id,
        targetKind: "cap",
        targetId: cap.id,
        action: "cap.created",
        afterState: cap,
        eventData: {
          submission_id: submission.id,
          question_id: q.id,
          source: "auto_audit_fail",
          was_critical: q.is_critical,
        },
      });

      created.push(cap.id);
    } catch (err) {
      console.warn("[workspace-submissions] auto-CAP loop error:", err?.message || err);
    }
  }

  return { created: created.length, ids: created };
}

// Build an answer row for INSERT, doing per-field validation. Shared
// between createSubmission and createRevisionSubmission. Throws a
// `{ httpCode, message }` shape that the caller turns into a respond().
function buildAnswerRow(q, a) {
  let auditResult = null;
  if (q.field_type === "pass_fail_na" && a.audit_result != null) {
    if (!ALLOWED_AUDIT_RESULT.includes(a.audit_result)) {
      throw { httpCode: 400, message: `Bad audit_result for "${q.question_text}". Must be pass|fail|na.` };
    }
    auditResult = a.audit_result;
  }

  // Flagged-fail notes: when a question requires a CAP on fail, the
  // assignee must capture WHY it failed inline so the CAP arrives with
  // useful context. Enforced server-side so the rule can't be bypassed
  // by tampering with the client.
  if (
    q.field_type === "pass_fail_na"
    && q.requires_cap_on_fail
    && auditResult === "fail"
    && (typeof a.answer_text !== "string" || a.answer_text.trim() === "")
  ) {
    throw {
      httpCode: 400,
      message: `Failed "${q.question_text}" needs a note explaining what went wrong.`,
      question_id: q.id,
    };
  }

  let attachmentIds = null;
  if (Array.isArray(a.attachment_ids) && a.attachment_ids.length) {
    for (const aid of a.attachment_ids) {
      if (!isUuid(aid)) {
        throw { httpCode: 400, message: "Invalid attachment_id in answer." };
      }
    }
    attachmentIds = a.attachment_ids;
  }

  return {
    question_id: q.id,
    answer_text:    a.answer_text ?? null,
    answer_number:  a.answer_number != null ? Number(a.answer_number) : null,
    answer_boolean: typeof a.answer_boolean === "boolean" ? a.answer_boolean : null,
    answer_date:    a.answer_date ?? null,
    answer_json:    a.answer_json ?? null,
    attachment_ids: attachmentIds,
    audit_result:   auditResult,
    audit_was_critical: q.field_type === "pass_fail_na" ? !!q.is_critical : null,
    captured_at:    a.captured_at ?? null,
    geo_lat:        a.geo_lat ?? null,
    geo_lng:        a.geo_lng ?? null,
  };
}

// ── Handler ──────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  const profile = await getCallerProfile(event);
  if (!profile) {
    return respond(401, { ok: false, message: "Not authenticated." });
  }

  const action = (event.queryStringParameters || {}).action || "";
  const supabase = getSupabase();

  try {
    // ═══════════════════════════════════════════════════════════
    // SUBMISSIONS
    // ═══════════════════════════════════════════════════════════

    if (action === "listSubmissions") {
      const wsId = (event.queryStringParameters || {}).workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_submissions");
      if (denied) return denied;

      const qp = event.queryStringParameters || {};
      const limit = Math.min(parseInt(qp.limit, 10) || 100, 500);

      // Filter by workspace via the assignment join — PostgREST can't
      // filter on nested FKs directly, so we resolve assignment_ids
      // for this workspace first.
      const { data: wsAsns } = await supabase
        .from("workspace_assignments")
        .select("id")
        .eq("workspace_id", wsId);
      const wsAsnIds = (wsAsns || []).map((a) => a.id);
      if (!wsAsnIds.length) return respond(200, { ok: true, submissions: [] });

      let q = supabase
        .from("workspace_submissions")
        .select(`
          *,
          assignment:assignment_id(id, workspace_id, store_id, template_id, assignee_id),
          submitter:submitted_by_id(id, full_name, email, role)
        `)
        .in("assignment_id", wsAsnIds)
        .order("submitted_at", { ascending: false })
        .limit(limit);

      if (qp.signoff_status) {
        const statuses = qp.signoff_status.split(",")
          .filter((s) => ALLOWED_SIGNOFF_STATUS.includes(s));
        if (statuses.length) q = q.in("signoff_status", statuses);
      }
      if (qp.submitter_id && isUuid(qp.submitter_id)) {
        q = q.eq("submitted_by_id", qp.submitter_id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, submissions: data || [] });
    }

    if (action === "getSubmission") {
      const id = (event.queryStringParameters || {}).id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad submission id." });

      const { data: sub, error } = await supabase
        .from("workspace_submissions")
        .select(`
          *,
          assignment:assignment_id(*),
          submitter:submitted_by_id(id, full_name, email, role),
          template_version:template_version_id(id, version_number, status, template_id)
        `)
        .eq("id", id)
        .single();
      if (error || !sub) return respond(404, { ok: false, message: "Submission not found." });

      const workspaceId = sub.assignment?.workspace_id;

      const isSubmitter = sub.submitted_by_id === profile.id;
      const isAssignee = sub.assignment?.assignee_id === profile.id;
      let isCandidate = false;
      if (!isSubmitter && !isAssignee) {
        const { data: candidateRows } = await supabase
          .from("workspace_submission_signoffs")
          .select("candidate_user_ids")
          .eq("submission_id", id);
        for (const r of candidateRows || []) {
          if ((r.candidate_user_ids || []).includes(profile.id)) {
            isCandidate = true;
            break;
          }
        }
      }
      if (!isSubmitter && !isAssignee && !isCandidate) {
        const denied = await requireWorkspaceCap(supabase, profile, workspaceId, "view_submissions");
        if (denied) return denied;
      }

      const [{ data: answers }, { data: signoffs }] = await Promise.all([
        supabase
          .from("workspace_submission_answers")
          .select("*, question:question_id(*)")
          .eq("submission_id", id)
          .order("created_at"),
        supabase
          .from("workspace_submission_signoffs")
          .select("*, step:step_id(label, approver_rule)")
          .eq("submission_id", id)
          .order("step_number"),
      ]);

      return respond(200, {
        ok: true,
        submission: sub,
        answers: answers || [],
        signoffs: signoffs || [],
      });
    }

    if (action === "createSubmission" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const asnId = payload.assignment_id;
      if (!isUuid(asnId)) return respond(400, { ok: false, message: "Bad assignment_id." });
      if (!Array.isArray(payload.answers)) {
        return respond(400, { ok: false, message: "answers[] required." });
      }

      const { data: asn } = await supabase
        .from("workspace_assignments").select("*").eq("id", asnId).single();
      if (!asn) return respond(404, { ok: false, message: "Assignment not found." });
      if (asn.status === "cancelled") {
        return respond(400, { ok: false, message: "Assignment is cancelled." });
      }
      if (asn.status === "submitted") {
        return respond(400, {
          ok: false,
          message: "Already submitted. Use createRevisionSubmission to revise.",
        });
      }

      const isAssignee = asn.assignee_id === profile.id;
      if (!isAssignee) {
        const denied = await requireWorkspaceCap(supabase, profile, asn.workspace_id, "fill_assignment");
        if (denied) return respond(403, { ok: false, message: "Only the assignee (or editor) can submit." });
      }

      const { data: ver } = await supabase
        .from("workspace_template_versions")
        .select("*, workspace_templates:template_id(*)")
        .eq("id", asn.template_version_id)
        .single();
      if (!ver) return respond(500, { ok: false, message: "Template version missing for assignment." });
      const template = ver.workspace_templates;

      const [{ data: questions }, { data: steps }, { data: workspace }] = await Promise.all([
        supabase.from("workspace_template_questions").select("*").eq("version_id", ver.id).order("position"),
        supabase.from("workspace_template_approval_steps").select("*").eq("version_id", ver.id).order("step_number"),
        supabase.from("workspaces").select("id, scope_anchor_kind, scope_anchor_id").eq("id", asn.workspace_id).single(),
      ]);

      const answerByQid = new Map();
      for (const a of payload.answers) {
        if (!isUuid(a?.question_id)) {
          return respond(400, { ok: false, message: "Each answer requires a valid question_id." });
        }
        answerByQid.set(a.question_id, a);
      }

      const answerRows = [];
      for (const q of questions || []) {
        const a = answerByQid.get(q.id);
        const hasAnswer = a && (
          a.answer_text != null
          || a.answer_number != null
          || a.answer_boolean != null
          || a.answer_date != null
          || a.answer_json != null
          || (Array.isArray(a.attachment_ids) && a.attachment_ids.length > 0)
          || (q.field_type === "pass_fail_na" && a.audit_result != null)
        );
        if (q.is_required && !hasAnswer) {
          return respond(400, {
            ok: false,
            message: `Required question unanswered: "${q.question_text}".`,
            question_id: q.id,
          });
        }
        if (!a) continue;
        try {
          answerRows.push(buildAnswerRow(q, a));
        } catch (err) {
          if (err && err.httpCode) return respond(err.httpCode, { ok: false, ...err });
          throw err;
        }
      }

      let scoringFields = {};
      if (template.type === "audit") {
        scoringFields = computeAuditScoring(template, questions || [], answerRows);
      }

      const { data: sub, error: subErr } = await supabase
        .from("workspace_submissions")
        .insert({
          assignment_id: asnId,
          template_version_id: ver.id,
          submitted_by_id: profile.id,
          submitted_at: new Date().toISOString(),
          version_number: 1,
          ...scoringFields,
          signoff_status: (steps && steps.length) ? "pending_review" : "approved",
          is_locked: true,
        })
        .select("*")
        .single();
      if (subErr) throw subErr;

      let insertedAnswers = [];
      if (answerRows.length) {
        const rows = answerRows.map((r) => ({ ...r, submission_id: sub.id }));
        const { data, error: ansErr } = await supabase
          .from("workspace_submission_answers").insert(rows).select("*");
        if (ansErr) {
          await supabase.from("workspace_submissions").delete().eq("id", sub.id);
          throw ansErr;
        }
        insertedAnswers = data || [];
      }

      if (steps && steps.length) {
        const signoffRows = [];
        for (const step of steps) {
          const candidates = await resolveSignoffCandidates(supabase, step, workspace, asn.store_id);
          signoffRows.push({
            submission_id: sub.id,
            step_id: step.id,
            step_number: step.step_number,
            status: "pending",
            candidate_user_ids: candidates,
          });
        }
        await supabase.from("workspace_submission_signoffs").insert(signoffRows);
      }

      const capResult = await autoCreateCapsForAuditAnswers({
        supabase, profile, template, questions, insertedAnswers,
        workspace, assignment: asn, submission: sub,
      });

      await supabase
        .from("workspace_assignments")
        .update({ status: "submitted" })
        .eq("id", asnId);

      // Submission is canonical now — clear the autosaved draft.
      await deleteDraft(supabase, asnId, profile.id);

      await logActivity(supabase, profile, {
        workspaceId: asn.workspace_id,
        targetKind: "submission",
        targetId: sub.id,
        action: "submission.created",
        afterState: sub,
        eventData: {
          assignment_id: asnId,
          template_id: template.id,
          template_version_id: ver.id,
          answer_count: answerRows.length,
          ...scoringFields,
          signoff_step_count: (steps || []).length,
          auto_caps_created: capResult.created,
        },
      });
      await logActivity(supabase, profile, {
        workspaceId: asn.workspace_id,
        targetKind: "assignment",
        targetId: asnId,
        action: "assignment.submitted",
        eventData: { submission_id: sub.id },
      });

      return respond(200, { ok: true, submission: sub });
    }

    if (action === "createRevisionSubmission" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const parentId = payload.parent_submission_id;
      if (!isUuid(parentId)) return respond(400, { ok: false, message: "Bad parent_submission_id." });
      if (!Array.isArray(payload.answers)) {
        return respond(400, { ok: false, message: "answers[] required." });
      }

      const { data: parent } = await supabase
        .from("workspace_submissions")
        .select("*, assignment:assignment_id(*)")
        .eq("id", parentId)
        .single();
      if (!parent) return respond(404, { ok: false, message: "Parent submission not found." });
      if (parent.signoff_status !== "revision_requested") {
        return respond(400, {
          ok: false,
          message: `Parent is not in revision_requested state (current: ${parent.signoff_status}).`,
        });
      }

      const asn = parent.assignment;
      const isAssignee = asn?.assignee_id === profile.id;
      if (!isAssignee) {
        const denied = await requireWorkspaceCap(supabase, profile, asn.workspace_id, "fill_assignment");
        if (denied) return respond(403, { ok: false, message: "Only the assignee (or editor) can revise." });
      }

      const { data: ver } = await supabase
        .from("workspace_template_versions")
        .select("*, workspace_templates:template_id(*)")
        .eq("id", parent.template_version_id)
        .single();
      const template = ver.workspace_templates;
      const [{ data: questions }, { data: steps }, { data: workspace }] = await Promise.all([
        supabase.from("workspace_template_questions").select("*").eq("version_id", ver.id).order("position"),
        supabase.from("workspace_template_approval_steps").select("*").eq("version_id", ver.id).order("step_number"),
        supabase.from("workspaces").select("id, scope_anchor_kind, scope_anchor_id").eq("id", asn.workspace_id).single(),
      ]);

      const answerByQid = new Map();
      for (const a of payload.answers) {
        if (!isUuid(a?.question_id)) {
          return respond(400, { ok: false, message: "Each answer requires a valid question_id." });
        }
        answerByQid.set(a.question_id, a);
      }
      const answerRows = [];
      for (const q of questions || []) {
        const a = answerByQid.get(q.id);
        const hasAnswer = a && (
          a.answer_text != null || a.answer_number != null || a.answer_boolean != null
          || a.answer_date != null || a.answer_json != null
          || (Array.isArray(a.attachment_ids) && a.attachment_ids.length > 0)
          || (q.field_type === "pass_fail_na" && a.audit_result != null)
        );
        if (q.is_required && !hasAnswer) {
          return respond(400, {
            ok: false, message: `Required question unanswered: "${q.question_text}".`,
          });
        }
        if (!a) continue;
        try {
          answerRows.push(buildAnswerRow(q, a));
        } catch (err) {
          if (err && err.httpCode) return respond(err.httpCode, { ok: false, ...err });
          throw err;
        }
      }

      let scoringFields = {};
      if (template.type === "audit") {
        scoringFields = computeAuditScoring(template, questions || [], answerRows);
      }

      const { data: sub, error: subErr } = await supabase
        .from("workspace_submissions")
        .insert({
          assignment_id: asn.id,
          template_version_id: ver.id,
          submitted_by_id: profile.id,
          submitted_at: new Date().toISOString(),
          parent_submission_id: parentId,
          version_number: (parent.version_number || 1) + 1,
          revision_reason: (payload.revision_reason || "").trim() || null,
          ...scoringFields,
          signoff_status: (steps && steps.length) ? "pending_review" : "approved",
          is_locked: true,
        })
        .select("*")
        .single();
      if (subErr) throw subErr;

      let insertedAnswers = [];
      if (answerRows.length) {
        const rows = answerRows.map((r) => ({ ...r, submission_id: sub.id }));
        const { data, error: ansErr } = await supabase
          .from("workspace_submission_answers").insert(rows).select("*");
        if (ansErr) {
          await supabase.from("workspace_submissions").delete().eq("id", sub.id);
          throw ansErr;
        }
        insertedAnswers = data || [];
      }

      if (steps && steps.length) {
        const signoffRows = [];
        for (const step of steps) {
          const candidates = await resolveSignoffCandidates(supabase, step, workspace, asn.store_id);
          signoffRows.push({
            submission_id: sub.id,
            step_id: step.id,
            step_number: step.step_number,
            status: "pending",
            candidate_user_ids: candidates,
          });
        }
        await supabase.from("workspace_submission_signoffs").insert(signoffRows);
      }

      const capResult = await autoCreateCapsForAuditAnswers({
        supabase, profile, template, questions, insertedAnswers,
        workspace, assignment: asn, submission: sub,
      });

      await deleteDraft(supabase, asn.id, profile.id);

      await logActivity(supabase, profile, {
        workspaceId: asn.workspace_id,
        targetKind: "submission",
        targetId: sub.id,
        action: "submission.revision_created",
        afterState: sub,
        eventData: {
          parent_submission_id: parentId,
          version_number: sub.version_number,
          revision_reason: sub.revision_reason,
          auto_caps_created: capResult.created,
        },
      });

      return respond(200, { ok: true, submission: sub });
    }

    if (action === "unlockSubmission" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad submission id." });

      const { data: sub } = await supabase
        .from("workspace_submissions")
        .select("*, assignment:assignment_id(workspace_id)")
        .eq("id", id)
        .single();
      if (!sub) return respond(404, { ok: false, message: "Submission not found." });

      const wsId = sub.assignment?.workspace_id;
      const denied = await requireWorkspaceCap(supabase, profile, wsId, "unlock_submission");
      if (denied) return denied;

      if (!sub.is_locked) return respond(200, { ok: true, submission: sub, unchanged: true });

      const { data: after, error } = await supabase
        .from("workspace_submissions")
        .update({ is_locked: false })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "submission",
        targetId: id,
        action: "submission.unlocked",
        eventData: { reason: payload.reason || null },
      });

      return respond(200, { ok: true, submission: after });
    }

    if (action === "relockSubmission" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad submission id." });

      const { data: sub } = await supabase
        .from("workspace_submissions")
        .select("*, assignment:assignment_id(workspace_id)")
        .eq("id", id)
        .single();
      if (!sub) return respond(404, { ok: false, message: "Submission not found." });

      const wsId = sub.assignment?.workspace_id;
      const denied = await requireWorkspaceCap(supabase, profile, wsId, "unlock_submission");
      if (denied) return denied;

      if (sub.is_locked) return respond(200, { ok: true, submission: sub, unchanged: true });

      const { data: after, error } = await supabase
        .from("workspace_submissions")
        .update({ is_locked: true })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "submission",
        targetId: id,
        action: "submission.locked",
      });

      return respond(200, { ok: true, submission: after });
    }

    // ═══════════════════════════════════════════════════════════
    // DRAFTS
    // ═══════════════════════════════════════════════════════════

    if (action === "loadDraft") {
      const asnId = (event.queryStringParameters || {}).assignment_id;
      if (!isUuid(asnId)) return respond(400, { ok: false, message: "Bad assignment_id." });

      const { data: asn } = await supabase
        .from("workspace_assignments")
        .select("id, workspace_id, template_version_id, assignee_id, status")
        .eq("id", asnId)
        .single();
      if (!asn) return respond(404, { ok: false, message: "Assignment not found." });

      if (asn.assignee_id !== profile.id) {
        return respond(403, { ok: false, message: "Drafts are per-assignee." });
      }

      const { data: draft } = await supabase
        .from("workspace_submission_drafts")
        .select("*")
        .eq("assignment_id", asnId)
        .eq("user_id", profile.id)
        .maybeSingle();

      if (!draft) return respond(200, { ok: true, draft: null, stale: false });
      const stale = draft.template_version_id !== asn.template_version_id;
      return respond(200, { ok: true, draft, stale });
    }

    if (action === "saveDraft" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const asnId = payload.assignment_id;
      const verId = payload.template_version_id;
      const clientUpdatedAt = payload.client_updated_at;
      const answers = payload.answers;

      if (!isUuid(asnId)) return respond(400, { ok: false, message: "Bad assignment_id." });
      if (!isUuid(verId)) return respond(400, { ok: false, message: "Bad template_version_id." });
      if (!Array.isArray(answers)) return respond(400, { ok: false, message: "answers[] required." });
      if (!clientUpdatedAt || Number.isNaN(Date.parse(clientUpdatedAt))) {
        return respond(400, { ok: false, message: "client_updated_at required (ISO timestamp)." });
      }

      const { data: asn } = await supabase
        .from("workspace_assignments")
        .select("id, assignee_id, template_version_id, status")
        .eq("id", asnId)
        .single();
      if (!asn) return respond(404, { ok: false, message: "Assignment not found." });
      if (asn.assignee_id !== profile.id) {
        return respond(403, { ok: false, message: "Drafts are per-assignee." });
      }
      if (asn.status === "submitted" || asn.status === "cancelled") {
        return respond(400, { ok: false, message: `Assignment is ${asn.status}; cannot save draft.` });
      }

      const { data: existing } = await supabase
        .from("workspace_submission_drafts")
        .select("client_updated_at")
        .eq("assignment_id", asnId)
        .eq("user_id", profile.id)
        .maybeSingle();
      if (existing && Date.parse(existing.client_updated_at) > Date.parse(clientUpdatedAt)) {
        return respond(200, { ok: true, skipped: true, reason: "older_than_existing" });
      }

      const { data: draft, error } = await supabase
        .from("workspace_submission_drafts")
        .upsert({
          assignment_id: asnId,
          user_id: profile.id,
          template_version_id: verId,
          answers,
          client_updated_at: clientUpdatedAt,
          last_saved_at: new Date().toISOString(),
        }, { onConflict: "assignment_id,user_id" })
        .select("*")
        .single();
      if (error) throw error;

      return respond(200, { ok: true, draft });
    }

    // Discarding a draft also cleans up any photo/file attachments
    // referenced inside it — otherwise we'd leak storage objects every
    // time a user starts a form and bails. Best-effort: if one
    // attachment delete fails, we still drop the draft row.
    if (action === "discardDraft" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const asnId = payload.assignment_id;
      if (!isUuid(asnId)) return respond(400, { ok: false, message: "Bad assignment_id." });

      const { data: draft } = await supabase
        .from("workspace_submission_drafts")
        .select("answers")
        .eq("assignment_id", asnId)
        .eq("user_id", profile.id)
        .maybeSingle();

      const attachmentIds = [];
      if (draft && Array.isArray(draft.answers)) {
        for (const a of draft.answers) {
          if (a && Array.isArray(a.attachment_ids)) {
            for (const aid of a.attachment_ids) {
              if (isUuid(aid)) attachmentIds.push(aid);
            }
          }
        }
      }

      if (attachmentIds.length) {
        const { data: rows } = await supabase
          .from("workspace_attachments")
          .select("id, storage_path, workspace_id, uploaded_by_id")
          .in("id", attachmentIds);
        const paths = (rows || [])
          .filter((r) => r.uploaded_by_id === profile.id)
          .map((r) => r.storage_path);
        if (paths.length) {
          try {
            await supabase.storage.from("workspace-attachments").remove(paths);
          } catch (err) {
            console.warn("[workspace-submissions] discardDraft storage cleanup:", err?.message || err);
          }
          await supabase
            .from("workspace_attachments")
            .delete()
            .in("id", (rows || []).filter((r) => r.uploaded_by_id === profile.id).map((r) => r.id));
        }
      }

      const { error } = await supabase
        .from("workspace_submission_drafts")
        .delete()
        .eq("assignment_id", asnId)
        .eq("user_id", profile.id);
      if (error) throw error;

      return respond(200, { ok: true, attachments_deleted: attachmentIds.length });
    }

    // ═══════════════════════════════════════════════════════════
    // SIGNOFFS
    // ═══════════════════════════════════════════════════════════

    if (action === "listMySignoffs") {
      const { data, error } = await supabase
        .from("workspace_submission_signoffs")
        .select(`
          *,
          submission:submission_id(
            id, submitted_at, signoff_status, audit_outcome,
            audit_score_percent, audit_critical_failed,
            assignment:assignment_id(id, workspace_id, store_id,
              workspaces:workspace_id(id, name),
              workspace_templates:template_id(id, name, type),
              store:store_id(id, store_number:number, name)
            )
          ),
          step:step_id(label)
        `)
        .eq("status", "pending")
        .contains("candidate_user_ids", [profile.id])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return respond(200, { ok: true, signoffs: data || [] });
    }

    if (action === "approveSignoff" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.signoff_id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad signoff_id." });

      const { data: signoff } = await supabase
        .from("workspace_submission_signoffs")
        .select("*, submission:submission_id(*, assignment:assignment_id(workspace_id))")
        .eq("id", id)
        .single();
      if (!signoff) return respond(404, { ok: false, message: "Signoff not found." });
      if (signoff.status !== "pending") {
        return respond(400, { ok: false, message: `Already actioned (status: ${signoff.status}).` });
      }

      const wsId = signoff.submission?.assignment?.workspace_id;
      const isCandidate = (signoff.candidate_user_ids || []).includes(profile.id);
      if (!isCandidate && !isOrgAdmin(profile)) {
        return respond(403, { ok: false, message: "You are not a candidate signer for this step." });
      }

      const { data: updatedStep, error: stepErr } = await supabase
        .from("workspace_submission_signoffs")
        .update({
          status: "approved",
          acted_by_id: profile.id,
          acted_at: new Date().toISOString(),
          notes: payload.notes || null,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (stepErr) throw stepErr;

      const { data: allSignoffs } = await supabase
        .from("workspace_submission_signoffs")
        .select("status, step_number")
        .eq("submission_id", signoff.submission_id);

      const anyPending = (allSignoffs || []).some((s) => s.status === "pending");
      const anyRejected = (allSignoffs || []).some((s) => s.status === "rejected");
      let newSubStatus;
      if (anyRejected) newSubStatus = "rejected";
      else if (anyPending) newSubStatus = "in_review";
      else newSubStatus = "approved";

      await supabase
        .from("workspace_submissions")
        .update({ signoff_status: newSubStatus })
        .eq("id", signoff.submission_id);

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "signoff",
        targetId: id,
        action: "signoff.approved",
        eventData: {
          submission_id: signoff.submission_id,
          step_number: signoff.step_number,
          new_submission_status: newSubStatus,
        },
        afterState: updatedStep,
      });

      return respond(200, { ok: true, signoff: updatedStep, submission_status: newSubStatus });
    }

    if (action === "rejectSignoff" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.signoff_id;
      const notes = (payload.notes || "").trim();
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad signoff_id." });
      if (!notes) return respond(400, { ok: false, message: "notes required for rejection." });

      const { data: signoff } = await supabase
        .from("workspace_submission_signoffs")
        .select("*, submission:submission_id(*, assignment:assignment_id(workspace_id))")
        .eq("id", id)
        .single();
      if (!signoff) return respond(404, { ok: false, message: "Signoff not found." });
      if (signoff.status !== "pending") {
        return respond(400, { ok: false, message: `Already actioned (status: ${signoff.status}).` });
      }

      const wsId = signoff.submission?.assignment?.workspace_id;
      const isCandidate = (signoff.candidate_user_ids || []).includes(profile.id);
      if (!isCandidate && !isOrgAdmin(profile)) {
        return respond(403, { ok: false, message: "You are not a candidate signer for this step." });
      }

      const nowIso = new Date().toISOString();
      const { data: updatedStep, error: stepErr } = await supabase
        .from("workspace_submission_signoffs")
        .update({
          status: "rejected",
          acted_by_id: profile.id,
          acted_at: nowIso,
          notes,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (stepErr) throw stepErr;

      await supabase
        .from("workspace_submission_signoffs")
        .update({ status: "skipped", acted_at: nowIso, notes: "auto-skipped due to upstream rejection" })
        .eq("submission_id", signoff.submission_id)
        .eq("status", "pending");

      await supabase
        .from("workspace_submissions")
        .update({ signoff_status: "rejected" })
        .eq("id", signoff.submission_id);

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "signoff",
        targetId: id,
        action: "signoff.rejected",
        eventData: {
          submission_id: signoff.submission_id,
          step_number: signoff.step_number,
          notes,
        },
        afterState: updatedStep,
      });

      return respond(200, { ok: true, signoff: updatedStep, submission_status: "rejected" });
    }

    if (action === "requestRevision" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.signoff_id;
      const notes = (payload.notes || "").trim();
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad signoff_id." });
      if (!notes) return respond(400, { ok: false, message: "notes required to request revision." });

      const { data: signoff } = await supabase
        .from("workspace_submission_signoffs")
        .select("*, submission:submission_id(*, assignment:assignment_id(workspace_id))")
        .eq("id", id)
        .single();
      if (!signoff) return respond(404, { ok: false, message: "Signoff not found." });
      if (signoff.status !== "pending") {
        return respond(400, { ok: false, message: `Already actioned (status: ${signoff.status}).` });
      }

      const wsId = signoff.submission?.assignment?.workspace_id;
      const isCandidate = (signoff.candidate_user_ids || []).includes(profile.id);
      if (!isCandidate && !isOrgAdmin(profile)) {
        return respond(403, { ok: false, message: "You are not a candidate signer for this step." });
      }

      const nowIso = new Date().toISOString();
      const { data: updatedStep, error: stepErr } = await supabase
        .from("workspace_submission_signoffs")
        .update({
          status: "rejected",
          acted_by_id: profile.id,
          acted_at: nowIso,
          notes,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (stepErr) throw stepErr;

      await supabase
        .from("workspace_submission_signoffs")
        .update({ status: "skipped", acted_at: nowIso, notes: "auto-skipped pending revision" })
        .eq("submission_id", signoff.submission_id)
        .eq("status", "pending");

      await supabase
        .from("workspace_submissions")
        .update({ signoff_status: "revision_requested" })
        .eq("id", signoff.submission_id);

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "signoff",
        targetId: id,
        action: "signoff.revision_requested",
        eventData: {
          submission_id: signoff.submission_id,
          step_number: signoff.step_number,
          notes,
        },
        afterState: updatedStep,
      });

      return respond(200, { ok: true, signoff: updatedStep, submission_status: "revision_requested" });
    }

    // ═══════════════════════════════════════════════════════════
    // ATTACHMENTS
    // ═══════════════════════════════════════════════════════════

    if (action === "listAttachments") {
      const wsId = (event.queryStringParameters || {}).workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const { data, error } = await supabase
        .from("workspace_attachments")
        .select("*")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return respond(200, { ok: true, attachments: data || [] });
    }

    if (action === "createAttachment" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      const storagePath = (payload.storage_path || "").trim();
      const fileName = (payload.file_name || "").trim();
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });
      if (!storagePath) return respond(400, { ok: false, message: "storage_path required." });
      if (!fileName) return respond(400, { ok: false, message: "file_name required." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "fill_assignment");
      if (denied) return denied;

      let fileSize = null;
      if (payload.file_size != null) {
        const n = parseInt(payload.file_size, 10);
        if (Number.isFinite(n) && n >= 0) fileSize = n;
      }

      const { data: att, error } = await supabase
        .from("workspace_attachments")
        .insert({
          workspace_id: wsId,
          storage_path: storagePath,
          file_name: fileName,
          file_size: fileSize,
          mime_type: payload.mime_type || null,
          role: payload.role || null,
          captured_at: payload.captured_at || null,
          geo_lat: payload.geo_lat ?? null,
          geo_lng: payload.geo_lng ?? null,
          uploaded_by_id: profile.id,
        })
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "attachment",
        targetId: att.id,
        action: "attachment.uploaded",
        afterState: att,
      });

      return respond(200, { ok: true, attachment: att });
    }

    // Upload an attachment in a single call: payload carries the file
    // bytes as base64 plus metadata. Direct client-to-storage uploads
    // aren't possible because the workspace-attachments bucket has no
    // INSERT policy (intentional — keeps anon out). Going through this
    // function bundles the storage put + the metadata row write under
    // one auth check.
    //
    // Caller is expected to have already compressed any large media.
    // MAX_UPLOAD_BYTES is a safety net, not a UX guideline.
    if (action === "uploadAttachment" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      const fileName = (payload.file_name || "").trim();
      const mimeType = (payload.mime_type || "").trim();
      const dataBase64 = payload.file_data_base64;

      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });
      if (!fileName) return respond(400, { ok: false, message: "file_name required." });
      if (!mimeType) return respond(400, { ok: false, message: "mime_type required." });
      if (typeof dataBase64 !== "string" || !dataBase64) {
        return respond(400, { ok: false, message: "file_data_base64 required." });
      }

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "fill_assignment");
      if (denied) return denied;

      let buf;
      try {
        buf = Buffer.from(dataBase64, "base64");
      } catch {
        return respond(400, { ok: false, message: "file_data_base64 is not valid base64." });
      }
      if (buf.length === 0) {
        return respond(400, { ok: false, message: "Empty file." });
      }
      if (buf.length > MAX_UPLOAD_BYTES) {
        return respond(400, {
          ok: false,
          message: `File too large (${Math.round(buf.length / 1024)} KB). Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        });
      }

      // Storage path: <workspace_id>/<uuid>-<safe-name>. Keep the
      // original name in the suffix for human-readable downloads but
      // strip anything that could collide with path traversal.
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      const path = `${wsId}/${randomUUID()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("workspace-attachments")
        .upload(path, buf, { contentType: mimeType, upsert: false });
      if (upErr) {
        return respond(500, { ok: false, message: `Upload failed: ${upErr.message}` });
      }

      const { data: att, error } = await supabase
        .from("workspace_attachments")
        .insert({
          workspace_id: wsId,
          storage_path: path,
          file_name: fileName,
          file_size: buf.length,
          mime_type: mimeType,
          role: payload.role || null,
          captured_at: payload.captured_at || null,
          geo_lat: payload.geo_lat ?? null,
          geo_lng: payload.geo_lng ?? null,
          uploaded_by_id: profile.id,
        })
        .select("*")
        .single();
      if (error) {
        // Cleanup the orphaned storage object so we don't leak bytes.
        await supabase.storage.from("workspace-attachments").remove([path]).catch(() => {});
        throw error;
      }

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "attachment",
        targetId: att.id,
        action: "attachment.uploaded",
        afterState: att,
        eventData: { method: "uploadAttachment", file_size: buf.length, mime_type: mimeType },
      });

      return respond(200, { ok: true, attachment: att });
    }

    if (action === "deleteAttachment" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad attachment id." });

      const { data: before } = await supabase
        .from("workspace_attachments").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Attachment not found." });

      const isOwner = before.uploaded_by_id === profile.id;
      if (!isOwner) {
        const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manage_members");
        if (denied) return respond(403, { ok: false, message: "Only uploader or owner can delete." });
      }

      const { error: storageErr } = await supabase.storage
        .from("workspace-attachments")
        .remove([before.storage_path]);
      if (storageErr) {
        console.warn("[workspace-submissions] storage remove failed:", storageErr.message);
      }

      const { error } = await supabase
        .from("workspace_attachments").delete().eq("id", id);
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "attachment",
        targetId: id,
        action: "attachment.deleted",
        beforeState: before,
      });

      return respond(200, { ok: true });
    }

    // Signed URL for downloading a private attachment. 60s default;
    // caller passes ?expires_in= up to 3600.
    if (action === "getAttachmentSignedUrl") {
      const id = (event.queryStringParameters || {}).id;
      const expiresIn = Math.min(
        parseInt((event.queryStringParameters || {}).expires_in, 10) || 60,
        3600,
      );
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad attachment id." });

      const { data: att } = await supabase
        .from("workspace_attachments").select("*").eq("id", id).single();
      if (!att) return respond(404, { ok: false, message: "Attachment not found." });

      const denied = await requireWorkspaceCap(supabase, profile, att.workspace_id, "view_workspace");
      if (denied) return denied;

      const { data: signed, error } = await supabase.storage
        .from("workspace-attachments")
        .createSignedUrl(att.storage_path, expiresIn);
      if (error) throw error;

      return respond(200, {
        ok: true,
        signed_url: signed.signedUrl,
        expires_in: expiresIn,
        attachment: att,
      });
    }

    return respond(404, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error("workspace-submissions handler error:", err);
    return respond(500, {
      ok: false,
      message: err?.message || "Internal server error.",
    });
  }
};
