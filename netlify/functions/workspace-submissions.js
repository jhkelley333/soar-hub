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
//   signoffs:     approveSignoff, rejectSignoff, requestRevision,
//                 listMySignoffs
//   attachments:  listAttachments, createAttachment, deleteAttachment,
//                 getAttachmentSignedUrl
//
// Frontend calls /.netlify/functions/workspace-submissions?action=...
// (workspaces.js still handles all other actions at its own URL.)

import { createClient } from "@supabase/supabase-js";
import {
  isOrgAdmin,
  requireWorkspaceCap,
} from "./_lib/workspace_permissions.js";
import {
  resolveSignoffCandidates,
  computeAuditScoring,
} from "./_lib/workspace_resolvers.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

const ALLOWED_SIGNOFF_STATUS = [
  "pending_review", "in_review", "approved", "rejected", "revision_requested",
];
const ALLOWED_AUDIT_RESULT = ["pass", "fail", "na"];

// ── Handler ─────────────────────────────────────────────────
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

    // Full submission detail: row + answers (with question metadata) +
    // signoffs (with step metadata). Visibility: submitter / assignee /
    // any signoff candidate / workspace member with view_submissions.
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

    // Submit a filled-out assignment. The big one. Validates answers
    // against the pinned template version, computes audit scoring if
    // applicable, resolves + snapshots signoff candidates, locks the
    // submission, and moves the assignment to status='submitted'.
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

      // Load the pinned template version + questions + approval steps + workspace.
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

      // Validate answers.
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

        let auditResult = null;
        if (q.field_type === "pass_fail_na" && a.audit_result != null) {
          if (!ALLOWED_AUDIT_RESULT.includes(a.audit_result)) {
            return respond(400, {
              ok: false,
              message: `Bad audit_result for "${q.question_text}". Must be pass|fail|na.`,
            });
          }
          auditResult = a.audit_result;
        }

        let attachmentIds = null;
        if (Array.isArray(a.attachment_ids) && a.attachment_ids.length) {
          for (const aid of a.attachment_ids) {
            if (!isUuid(aid)) {
              return respond(400, { ok: false, message: "Invalid attachment_id in answer." });
            }
          }
          attachmentIds = a.attachment_ids;
        }

        answerRows.push({
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
        });
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

      if (answerRows.length) {
        const rows = answerRows.map((r) => ({ ...r, submission_id: sub.id }));
        const { error: ansErr } = await supabase.from("workspace_submission_answers").insert(rows);
        if (ansErr) {
          await supabase.from("workspace_submissions").delete().eq("id", sub.id);
          throw ansErr;
        }
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

      await supabase
        .from("workspace_assignments")
        .update({ status: "submitted" })
        .eq("id", asnId);

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

    // Create a revision after a reviewer requested changes. Chains to
    // the parent_submission_id; bumps version_number. Refused if the
    // parent isn't in revision_requested state.
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
        let auditResult = null;
        if (q.field_type === "pass_fail_na" && a.audit_result != null) {
          if (!ALLOWED_AUDIT_RESULT.includes(a.audit_result)) {
            return respond(400, { ok: false, message: `Bad audit_result.` });
          }
          auditResult = a.audit_result;
        }
        answerRows.push({
          question_id: q.id,
          answer_text:    a.answer_text ?? null,
          answer_number:  a.answer_number != null ? Number(a.answer_number) : null,
          answer_boolean: typeof a.answer_boolean === "boolean" ? a.answer_boolean : null,
          answer_date:    a.answer_date ?? null,
          answer_json:    a.answer_json ?? null,
          attachment_ids: Array.isArray(a.attachment_ids) && a.attachment_ids.length ? a.attachment_ids : null,
          audit_result:   auditResult,
          audit_was_critical: q.field_type === "pass_fail_na" ? !!q.is_critical : null,
          captured_at:    a.captured_at ?? null,
          geo_lat:        a.geo_lat ?? null,
          geo_lng:        a.geo_lng ?? null,
        });
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

      if (answerRows.length) {
        const rows = answerRows.map((r) => ({ ...r, submission_id: sub.id }));
        const { error: ansErr } = await supabase.from("workspace_submission_answers").insert(rows);
        if (ansErr) {
          await supabase.from("workspace_submissions").delete().eq("id", sub.id);
          throw ansErr;
        }
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
              store:store_id(id, store_number, name)
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
