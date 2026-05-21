// netlify/functions/workspace-caps.js
//
// REST handler for the CAP (Corrective Action Plan) layer of the
// Workspace feature. Sibling to workspaces.js + workspace-submissions.js
// — same auth pattern, same capability map, same DB.
//
// Actions covered:
//   CAPs:             listCaps, listMyCaps, getCap, createCap,
//                     updateCap, reassignCap, startCap, closeCap
//   CAP proofs:       listCapProofs, createCapProof, verifyCapProof
//   Repeat findings:  listRepeatFindings, getRepeatFinding,
//                     acknowledgeRepeatFinding, resetRepeatFinding
//
// Frontend calls /.netlify/functions/workspace-caps?action=...
//
// Note on automation: this v1 slice supports MANUAL CAP creation and
// proof submission. Auto-CAP creation from audit failures (where
// question.requires_cap_on_fail=true) is a follow-up integration with
// workspace-submissions.js. For now, owners/editors create CAPs via
// createCap. Same for repeat-finding detection — manual upsert via
// the listRepeatFindings/acknowledge path; auto-aggregation TBD.

import { createClient } from "@supabase/supabase-js";
import {
  requireWorkspaceCap,
} from "./_lib/workspace_permissions.js";

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
  const header = event.headers?.authorization || event.headers?.Authorization;
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
    console.warn("workspace-caps.logActivity failed:", err?.message || err);
  }
}

const ALLOWED_CAP_STATUS = [
  "open", "in_progress", "proof_submitted", "verified", "closed", "reopened",
];

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
    // CAPs
    // ═══════════════════════════════════════════════════════════

    if (action === "listCaps") {
      const qp = event.queryStringParameters || {};
      const wsId = qp.workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_caps");
      if (denied) return denied;

      const limit = Math.min(parseInt(qp.limit, 10) || 100, 500);

      let q = supabase
        .from("workspace_corrective_action_plans")
        .select(`
          *,
          assignee:assignee_id(id, full_name, email, role),
          verifier:verifier_id(id, full_name, email, role),
          store:store_id(id, store_number, name),
          question:question_id(id, question_text, is_critical, weight)
        `)
        .eq("workspace_id", wsId)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(limit);

      if (qp.status) {
        const statuses = qp.status.split(",").filter((s) => ALLOWED_CAP_STATUS.includes(s));
        if (statuses.length) q = q.in("status", statuses);
      }
      if (qp.assignee_id && isUuid(qp.assignee_id)) {
        q = q.eq("assignee_id", qp.assignee_id);
      }
      if (qp.verifier_id && isUuid(qp.verifier_id)) {
        q = q.eq("verifier_id", qp.verifier_id);
      }
      if (qp.store_id && isUuid(qp.store_id)) {
        q = q.eq("store_id", qp.store_id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, caps: data || [] });
    }

    // Caller's CAPs across all workspaces — both ones they own
    // (assignee_id) AND ones they verify (verifier_id). Default to
    // open/in-progress work; pass ?include_closed=true for full list.
    if (action === "listMyCaps") {
      const qp = event.queryStringParameters || {};
      const includeClosed = qp.include_closed === "true";

      let q = supabase
        .from("workspace_corrective_action_plans")
        .select(`
          *,
          workspaces:workspace_id(id, name),
          assignee:assignee_id(id, full_name, email),
          verifier:verifier_id(id, full_name, email),
          store:store_id(id, store_number, name),
          question:question_id(id, question_text)
        `)
        .or(`assignee_id.eq.${profile.id},verifier_id.eq.${profile.id}`)
        .order("due_at", { ascending: true, nullsFirst: false });

      if (!includeClosed) {
        q = q.in("status", ["open", "in_progress", "proof_submitted", "reopened"]);
      }

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, caps: data || [] });
    }

    if (action === "getCap") {
      const id = (event.queryStringParameters || {}).id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad cap id." });

      const { data: cap, error } = await supabase
        .from("workspace_corrective_action_plans")
        .select(`
          *,
          assignee:assignee_id(id, full_name, email, role),
          verifier:verifier_id(id, full_name, email, role),
          store:store_id(id, store_number, name),
          question:question_id(id, question_text, is_critical, weight, field_type),
          submission:submission_id(id, submitted_at, audit_outcome, signoff_status),
          answer:answer_id(id, audit_result, audit_was_critical, answer_text, answer_json)
        `)
        .eq("id", id)
        .single();
      if (error || !cap) return respond(404, { ok: false, message: "CAP not found." });

      // Visibility: assignee, verifier, or workspace_view caller.
      const isAssignee = cap.assignee_id === profile.id;
      const isVerifier = cap.verifier_id === profile.id;
      if (!isAssignee && !isVerifier) {
        const denied = await requireWorkspaceCap(supabase, profile, cap.workspace_id, "view_caps");
        if (denied) return denied;
      }

      // Pull proofs separately so the caller has a chronological list.
      const { data: proofs } = await supabase
        .from("workspace_cap_proofs")
        .select(`
          *,
          submitter:submitted_by_id(id, full_name, email),
          verifier:verified_by_id(id, full_name, email)
        `)
        .eq("cap_id", id)
        .order("submitted_at");

      return respond(200, { ok: true, cap, proofs: proofs || [] });
    }

    // Manual CAP creation. Owner/editor only. For auto-creation from
    // audit failures, see the integration in workspace-submissions.js
    // (TODO — currently manual-only).
    if (action === "createCap" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      const submissionId = payload.submission_id;
      const answerId = payload.answer_id;
      const questionId = payload.question_id;
      const assigneeId = payload.assignee_id;
      if (!isUuid(wsId))         return respond(400, { ok: false, message: "Bad workspace_id." });
      if (!isUuid(submissionId)) return respond(400, { ok: false, message: "Bad submission_id." });
      if (!isUuid(answerId))     return respond(400, { ok: false, message: "Bad answer_id." });
      if (!isUuid(questionId))   return respond(400, { ok: false, message: "Bad question_id." });
      if (!isUuid(assigneeId))   return respond(400, { ok: false, message: "Bad assignee_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "manually_create_cap");
      if (denied) return denied;

      // Confirm the submission lives in this workspace.
      const { data: sub } = await supabase
        .from("workspace_submissions")
        .select("id, assignment:assignment_id(workspace_id, store_id)")
        .eq("id", submissionId)
        .single();
      if (!sub) return respond(400, { ok: false, message: "Submission not found." });
      if (sub.assignment?.workspace_id !== wsId) {
        return respond(400, { ok: false, message: "Submission not in this workspace." });
      }

      // Optional fields with validation.
      let dueAt = null;
      if (payload.due_at) {
        const d = new Date(payload.due_at);
        if (isNaN(d.getTime())) return respond(400, { ok: false, message: "due_at must be ISO 8601." });
        dueAt = d.toISOString();
      }

      let verifierId = null;
      if (payload.verifier_id) {
        if (!isUuid(payload.verifier_id)) return respond(400, { ok: false, message: "Bad verifier_id." });
        verifierId = payload.verifier_id;
      }

      // Pull question.template_instructions if not overridden.
      let templateInstructions = (payload.template_instructions || "").trim() || null;
      if (!templateInstructions) {
        const { data: q } = await supabase
          .from("workspace_template_questions")
          .select("question_text, cap_assignee_rule")
          .eq("id", questionId)
          .maybeSingle();
        // Pre-populate from the question text so the assignee knows
        // what's being asked of them.
        templateInstructions = q?.question_text || null;
      }

      const { data: cap, error } = await supabase
        .from("workspace_corrective_action_plans")
        .insert({
          workspace_id: wsId,
          submission_id: submissionId,
          answer_id: answerId,
          question_id: questionId,
          store_id: sub.assignment?.store_id || null,
          assignee_id: assigneeId,
          verifier_id: verifierId,
          due_at: dueAt,
          status: "open",
          template_instructions: templateInstructions,
          failure_notes: (payload.failure_notes || "").trim() || null,
        })
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "cap",
        targetId: cap.id,
        action: "cap.created",
        afterState: cap,
        eventData: {
          submission_id: submissionId,
          question_id: questionId,
          source: "manual",
        },
      });

      return respond(200, { ok: true, cap });
    }

    // Patch CAP metadata (due_at, instructions, failure_notes).
    // Reassignment goes through reassignCap so the audit-log action
    // distinguishes "changed assignee" from "changed instructions".
    if (action === "updateCap" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad cap id." });

      const { data: before } = await supabase
        .from("workspace_corrective_action_plans").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "CAP not found." });

      // Owner/editor OR the CAP's assignee (for notes/due_at on their
      // own CAP) can update. Verifier can't edit metadata.
      const isAssignee = before.assignee_id === profile.id;
      if (!isAssignee) {
        const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manually_create_cap");
        if (denied) return denied;
      }

      const patch = {};
      if ("due_at" in payload) {
        if (payload.due_at == null || payload.due_at === "") {
          patch.due_at = null;
        } else {
          const d = new Date(payload.due_at);
          if (isNaN(d.getTime())) return respond(400, { ok: false, message: "due_at must be ISO 8601." });
          patch.due_at = d.toISOString();
        }
      }
      if ("template_instructions" in payload) {
        patch.template_instructions = (payload.template_instructions || "").trim() || null;
      }
      if ("failure_notes" in payload) {
        patch.failure_notes = (payload.failure_notes || "").trim() || null;
      }

      if (!Object.keys(patch).length) {
        return respond(400, { ok: false, message: "Nothing to update." });
      }

      const { data: after, error } = await supabase
        .from("workspace_corrective_action_plans")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      // Use cap.due_date_changed if due_at moved, else just cap.created
      // (no generic .updated action in the vocabulary, so we use the
      // most relevant one or fall back to event_data for context).
      const action_to_log = "due_at" in patch
        ? "cap.due_date_changed"
        : "cap.assigned"; // generic "changed" — assigned is least bad
      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "cap",
        targetId: id,
        action: action_to_log,
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, cap: after });
    }

    // Change assignee and/or verifier. Owner/editor only. Logged as
    // cap.assigned so the audit trail shows the handoff.
    if (action === "reassignCap" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad cap id." });

      const { data: before } = await supabase
        .from("workspace_corrective_action_plans").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "CAP not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "reassign_cap");
      if (denied) return denied;

      const patch = {};
      if ("assignee_id" in payload) {
        if (!isUuid(payload.assignee_id)) return respond(400, { ok: false, message: "Bad assignee_id." });
        const { data: target } = await supabase
          .from("profiles").select("id, is_active").eq("id", payload.assignee_id).maybeSingle();
        if (!target || !target.is_active) {
          return respond(400, { ok: false, message: "Assignee not found or inactive." });
        }
        patch.assignee_id = payload.assignee_id;
      }
      if ("verifier_id" in payload) {
        if (payload.verifier_id == null) {
          patch.verifier_id = null;
        } else {
          if (!isUuid(payload.verifier_id)) return respond(400, { ok: false, message: "Bad verifier_id." });
          const { data: target } = await supabase
            .from("profiles").select("id, is_active").eq("id", payload.verifier_id).maybeSingle();
          if (!target || !target.is_active) {
            return respond(400, { ok: false, message: "Verifier not found or inactive." });
          }
          patch.verifier_id = payload.verifier_id;
        }
      }

      if (!Object.keys(patch).length) {
        return respond(400, { ok: false, message: "Provide assignee_id or verifier_id." });
      }

      const { data: after, error } = await supabase
        .from("workspace_corrective_action_plans")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "cap",
        targetId: id,
        action: "cap.assigned",
        beforeState: before,
        afterState: after,
        eventData: { reassigned_fields: Object.keys(patch) },
      });

      return respond(200, { ok: true, cap: after });
    }

    // Assignee marks CAP in_progress. Idempotent.
    if (action === "startCap" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad cap id." });

      const { data: before } = await supabase
        .from("workspace_corrective_action_plans").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "CAP not found." });

      const isAssignee = before.assignee_id === profile.id;
      if (!isAssignee) {
        const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manually_create_cap");
        if (denied) return respond(403, { ok: false, message: "Only assignee (or editor) can start." });
      }

      if (before.status === "closed" || before.status === "verified") {
        return respond(400, { ok: false, message: `CAP already ${before.status}.` });
      }
      if (before.status === "in_progress") {
        return respond(200, { ok: true, cap: before, unchanged: true });
      }

      const { data: after, error } = await supabase
        .from("workspace_corrective_action_plans")
        .update({ status: "in_progress" })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "cap",
        targetId: id,
        action: "cap.started",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, cap: after });
    }

    // Owner/editor force-close. Use sparingly — proper close path is
    // verifyCapProof(accepted=true). This is for "no longer needed"
    // scenarios (e.g., template question was removed, store closed).
    if (action === "closeCap" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad cap id." });

      const { data: before } = await supabase
        .from("workspace_corrective_action_plans").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "CAP not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manually_create_cap");
      if (denied) return denied;

      if (before.status === "closed") {
        return respond(400, { ok: false, message: "Already closed." });
      }

      const { data: after, error } = await supabase
        .from("workspace_corrective_action_plans")
        .update({
          status: "closed",
          verified_at: new Date().toISOString(),
          verified_by_id: profile.id,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "cap",
        targetId: id,
        action: "cap.closed",
        beforeState: before,
        afterState: after,
        eventData: { reason: payload.reason || null, source: "manual_close" },
      });

      return respond(200, { ok: true, cap: after });
    }

    // ═══════════════════════════════════════════════════════════
    // CAP PROOFS
    // ═══════════════════════════════════════════════════════════

    if (action === "listCapProofs") {
      const capId = (event.queryStringParameters || {}).cap_id;
      if (!isUuid(capId)) return respond(400, { ok: false, message: "Bad cap_id." });

      const { data: cap } = await supabase
        .from("workspace_corrective_action_plans")
        .select("id, workspace_id, assignee_id, verifier_id")
        .eq("id", capId)
        .maybeSingle();
      if (!cap) return respond(404, { ok: false, message: "CAP not found." });

      const isAssignee = cap.assignee_id === profile.id;
      const isVerifier = cap.verifier_id === profile.id;
      if (!isAssignee && !isVerifier) {
        const denied = await requireWorkspaceCap(supabase, profile, cap.workspace_id, "view_caps");
        if (denied) return denied;
      }

      const { data, error } = await supabase
        .from("workspace_cap_proofs")
        .select(`
          *,
          submitter:submitted_by_id(id, full_name, email),
          verifier:verified_by_id(id, full_name, email)
        `)
        .eq("cap_id", capId)
        .order("submitted_at");
      if (error) throw error;
      return respond(200, { ok: true, proofs: data || [] });
    }

    // Assignee submits proof. Moves CAP to proof_submitted.
    if (action === "createCapProof" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const capId = payload.cap_id;
      if (!isUuid(capId)) return respond(400, { ok: false, message: "Bad cap_id." });

      const { data: cap } = await supabase
        .from("workspace_corrective_action_plans").select("*").eq("id", capId).single();
      if (!cap) return respond(404, { ok: false, message: "CAP not found." });

      const isAssignee = cap.assignee_id === profile.id;
      if (!isAssignee) {
        const denied = await requireWorkspaceCap(supabase, profile, cap.workspace_id, "manually_create_cap");
        if (denied) return respond(403, { ok: false, message: "Only assignee (or editor) can submit proof." });
      }

      if (cap.status === "closed" || cap.status === "verified") {
        return respond(400, { ok: false, message: `CAP is ${cap.status}; cannot submit proof.` });
      }

      let attachmentIds = null;
      if (Array.isArray(payload.attachment_ids) && payload.attachment_ids.length) {
        for (const aid of payload.attachment_ids) {
          if (!isUuid(aid)) return respond(400, { ok: false, message: "Invalid attachment_id." });
        }
        attachmentIds = payload.attachment_ids;
      }

      const { data: proof, error } = await supabase
        .from("workspace_cap_proofs")
        .insert({
          cap_id: capId,
          submitted_by_id: profile.id,
          notes: (payload.notes || "").trim() || null,
          attachment_ids: attachmentIds,
        })
        .select("*")
        .single();
      if (error) throw error;

      // Move CAP to proof_submitted so the verifier sees it in their
      // queue. Doesn't lock anything — assignee can resubmit if needed.
      await supabase
        .from("workspace_corrective_action_plans")
        .update({ status: "proof_submitted" })
        .eq("id", capId);

      await logActivity(supabase, profile, {
        workspaceId: cap.workspace_id,
        targetKind: "cap_proof",
        targetId: proof.id,
        action: "cap_proof.submitted",
        afterState: proof,
        eventData: { cap_id: capId },
      });

      return respond(200, { ok: true, proof });
    }

    // Verifier accepts or rejects. Accept → CAP verified+closed.
    // Reject → CAP reopened, reopened_count bumps.
    if (action === "verifyCapProof" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const proofId = payload.proof_id;
      const accepted = !!payload.accepted;
      const verifierNotes = (payload.verifier_notes || "").trim();
      if (!isUuid(proofId)) return respond(400, { ok: false, message: "Bad proof_id." });
      if (!accepted && !verifierNotes) {
        return respond(400, { ok: false, message: "verifier_notes required when rejecting." });
      }

      const { data: proof } = await supabase
        .from("workspace_cap_proofs")
        .select("*, cap:cap_id(*)")
        .eq("id", proofId)
        .single();
      if (!proof) return respond(404, { ok: false, message: "Proof not found." });
      if (proof.verified_status) {
        return respond(400, { ok: false, message: `Already ${proof.verified_status}.` });
      }

      const cap = proof.cap;
      const isVerifier = cap.verifier_id === profile.id;
      if (!isVerifier) {
        // Owner/editor override (handles "no verifier set" + "manual review" cases).
        const denied = await requireWorkspaceCap(supabase, profile, cap.workspace_id, "manually_create_cap");
        if (denied) return respond(403, { ok: false, message: "Only verifier (or editor) can verify proof." });
      }

      const nowIso = new Date().toISOString();
      const { data: updatedProof, error: pErr } = await supabase
        .from("workspace_cap_proofs")
        .update({
          verified_status: accepted ? "accepted" : "rejected",
          verified_at: nowIso,
          verified_by_id: profile.id,
          verifier_notes: verifierNotes || null,
        })
        .eq("id", proofId)
        .select("*")
        .single();
      if (pErr) throw pErr;

      // Update CAP based on outcome.
      let newStatus, capUpdates;
      if (accepted) {
        newStatus = "verified";
        capUpdates = {
          status: "verified",
          verified_at: nowIso,
          verified_by_id: profile.id,
        };
      } else {
        newStatus = "reopened";
        capUpdates = {
          status: "reopened",
          reopened_count: (cap.reopened_count || 0) + 1,
          last_reopened_at: nowIso,
        };
      }
      await supabase
        .from("workspace_corrective_action_plans")
        .update(capUpdates)
        .eq("id", cap.id);

      await logActivity(supabase, profile, {
        workspaceId: cap.workspace_id,
        targetKind: "cap_proof",
        targetId: proofId,
        action: accepted ? "cap_proof.accepted" : "cap_proof.rejected",
        afterState: updatedProof,
        eventData: { cap_id: cap.id, verifier_notes: verifierNotes || null },
      });
      await logActivity(supabase, profile, {
        workspaceId: cap.workspace_id,
        targetKind: "cap",
        targetId: cap.id,
        action: accepted ? "cap.verified" : "cap.reopened",
        eventData: {
          proof_id: proofId,
          reopened_count: accepted ? null : (cap.reopened_count || 0) + 1,
        },
      });

      return respond(200, {
        ok: true,
        proof: updatedProof,
        cap_status: newStatus,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // REPEAT FINDINGS
    // ═══════════════════════════════════════════════════════════

    if (action === "listRepeatFindings") {
      const qp = event.queryStringParameters || {};
      const wsId = qp.workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_caps");
      if (denied) return denied;

      let q = supabase
        .from("workspace_repeat_findings")
        .select(`
          *,
          store:store_id(id, store_number, name),
          question:question_id(id, question_text, is_critical, weight),
          acknowledged_by:acknowledged_by_id(id, full_name, email)
        `)
        .eq("workspace_id", wsId)
        .order("last_occurred_at", { ascending: false });

      if (qp.unacknowledged === "true") {
        q = q.is("acknowledged_at", null);
      }
      if (qp.store_id && isUuid(qp.store_id)) {
        q = q.eq("store_id", qp.store_id);
      }
      if (qp.question_id && isUuid(qp.question_id)) {
        q = q.eq("question_id", qp.question_id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, findings: data || [] });
    }

    if (action === "getRepeatFinding") {
      const id = (event.queryStringParameters || {}).id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad finding id." });

      const { data, error } = await supabase
        .from("workspace_repeat_findings")
        .select(`
          *,
          store:store_id(id, store_number, name),
          question:question_id(id, question_text, is_critical, weight),
          acknowledged_by:acknowledged_by_id(id, full_name, email)
        `)
        .eq("id", id)
        .single();
      if (error || !data) return respond(404, { ok: false, message: "Finding not found." });

      const denied = await requireWorkspaceCap(supabase, profile, data.workspace_id, "view_caps");
      if (denied) return denied;

      return respond(200, { ok: true, finding: data });
    }

    if (action === "acknowledgeRepeatFinding" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad finding id." });

      const { data: before } = await supabase
        .from("workspace_repeat_findings").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Finding not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manually_create_cap");
      if (denied) return denied;

      if (before.acknowledged_at) {
        return respond(400, { ok: false, message: "Already acknowledged." });
      }

      const note = (payload.acknowledged_note || "").trim() || null;
      const { data: after, error } = await supabase
        .from("workspace_repeat_findings")
        .update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by_id: profile.id,
          acknowledged_note: note,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "repeat_finding",
        targetId: id,
        action: "repeat_finding.acknowledged",
        beforeState: before,
        afterState: after,
        eventData: { acknowledged_note: note },
      });

      return respond(200, { ok: true, finding: after });
    }

    if (action === "resetRepeatFinding" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad finding id." });

      const { data: before } = await supabase
        .from("workspace_repeat_findings").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Finding not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manually_create_cap");
      if (denied) return denied;

      const { data: after, error } = await supabase
        .from("workspace_repeat_findings")
        .update({
          acknowledged_at: null,
          acknowledged_by_id: null,
          acknowledged_note: null,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "repeat_finding",
        targetId: id,
        action: "repeat_finding.reset",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, finding: after });
    }

    return respond(404, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error("workspace-caps handler error:", err);
    return respond(500, {
      ok: false,
      message: err?.message || "Internal server error.",
    });
  }
};
