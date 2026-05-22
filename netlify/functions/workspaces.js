// netlify/functions/workspaces.js
//
// REST handler for the Workspace feature (forms + audits + CAPs +
// automations). Supabase Bearer-JWT auth, service-role client.
//
// Actions covered:
//   workspaces:        listMine, getWorkspace, createWorkspace,
//                      updateWorkspace, archiveWorkspace, unarchiveWorkspace,
//                      deleteWorkspace  (admin-only hard delete)
//   members:           listMembers, addMember, updateMember, removeMember
//   templates:         listTemplates, getTemplate, createTemplate,
//                      updateTemplate, archiveTemplate, unarchiveTemplate
//   template versions: listTemplateVersions, getTemplateVersion,
//                      createTemplateVersion (forks from published),
//                      publishTemplateVersion (auto-archives previous),
//                      archiveTemplateVersion
//   questions:         listQuestions, upsertQuestions  (draft-only)
//   approval steps:    listApprovalSteps, upsertApprovalSteps  (draft-only)
//   schedules:         listSchedules, getSchedule, createSchedule,
//                      updateSchedule, toggleSchedule, deleteSchedule
//   assignments:       listAssignments, listMyAssignments, getAssignment,
//                      createAssignment, cancelAssignment, startAssignment
//   activity log:      getActivity  (owner / admin only)
//
// Versioning model: once a version is 'published', it's immutable.
// To change anything, fork a new draft (createTemplateVersion),
// edit it via upsertQuestions / upsertApprovalSteps, then publish it
// (publishTemplateVersion auto-archives the previously published one).
// Assignments + submissions reference template_version_id, so old
// submissions stay forever bound to the questions they answered.
//
// Assignments, submissions, CAPs, and automations get added in
// follow-up slices as we work through each domain.
//
// Auth model:
//   - Every request must carry a Bearer token; we validate via
//     supabase.auth.getUser(token) and fetch the profile row.
//   - The DB client uses SERVICE_KEY (bypasses RLS) — permission
//     enforcement lives in _lib/workspace_permissions.js, not in
//     Postgres policies (those are defense-in-depth only).
//   - canGlobal() gates "anyone can do this at all" capabilities
//     (e.g. create_workspace = DO+).
//   - canInWorkspace() gates per-workspace capabilities based on
//     workspace_members.workspace_role, with admin org-tier bypass.
//
// Every write that mutates a workspace, member, or visible state
// writes a row to workspace_activity_log via logActivity().

import { createClient } from "@supabase/supabase-js";
import {
  isOrgAdmin,
  requireGlobalCap,
  requireWorkspaceCap,
  workspaceRoleFor,
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

// ── Activity log helper ───────────────────────────────
//
// Writes a row to workspace_activity_log. Snapshots actor identity
// (id, email, role) so audit history survives profile deletion.
// Best-effort: failures are logged but do not block the caller's
// action — the audit log is a recorder, not a gate.
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
    console.warn("workspaces.logActivity failed:", err?.message || err);
  }
}

// ── Visibility resolution ──────────────────────────────
//
// Returns the list of workspace IDs visible to the caller. Mirrors
// the workspaces_select RLS policy logic, but runs in JS because we
// use service-role for the DB connection (RLS bypassed).
//
// A workspace is visible iff any of:
//   1. Caller is admin/payroll (org-tier admin) — sees ALL workspaces.
//   2. Caller is in workspace_members for it.
//   3. Workspace visibility = 'organization' (any active profile sees it).
//   4. Workspace visibility = 'scoped' with a scope_anchor_* AND the
//      caller's user_scopes hierarchy covers that anchor.
//
// Returns { all: true } for admin (skip the explicit list) or
// { all: false, ids: uuid[] } for everyone else.
async function visibleWorkspaceIds(supabase, profile) {
  if (isOrgAdmin(profile)) return { all: true };

  // Build the union of explicit-member + organization-wide visibility.
  const [memberRows, orgWideRows] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", profile.id),
    supabase
      .from("workspaces")
      .select("id")
      .eq("visibility", "organization")
      .eq("is_archived", false),
  ]);

  const ids = new Set();
  for (const r of memberRows.data || []) ids.add(r.workspace_id);
  for (const r of orgWideRows.data || []) ids.add(r.id);

  // Scope-anchored visibility — resolve which anchors the caller can
  // see via user_visible_regions/areas/districts/stores helpers.
  const { data: anchored } = await supabase
    .from("workspaces")
    .select("id, scope_anchor_kind, scope_anchor_id")
    .eq("visibility", "scoped")
    .eq("is_archived", false)
    .not("scope_anchor_id", "is", null);

  if (anchored?.length) {
    // Group by kind so we make one RPC-ish call per kind.
    const byKind = { region: [], area: [], district: [], store: [] };
    for (const w of anchored) {
      if (byKind[w.scope_anchor_kind]) {
        byKind[w.scope_anchor_kind].push(w);
      }
    }

    for (const kind of Object.keys(byKind)) {
      if (!byKind[kind].length) continue;
      const helper = `user_visible_${kind === "area" ? "areas"
                    : kind === "region" ? "regions"
                    : kind === "district" ? "districts"
                    : "stores"}`;
      const { data: visIds } = await supabase.rpc(helper, { uid: profile.id });
      if (!visIds) continue;
      const visSet = new Set((visIds || []).map((r) => r.id || r));
      for (const w of byKind[kind]) {
        if (visSet.has(w.scope_anchor_id)) ids.add(w.id);
      }
    }
  }

  return { all: false, ids: Array.from(ids) };
}

// ── Validation helpers ─────────────────────────────
function isUuid(s) {
  return typeof s === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const ALLOWED_VISIBILITY = ["private", "scoped", "organization"];
const ALLOWED_ANCHOR_KIND = ["region", "area", "district", "store"];
const ALLOWED_MEMBER_ROLE = ["owner", "editor", "submitter", "viewer"];
const ALLOWED_TEMPLATE_TYPE = ["form", "audit"];
const ALLOWED_FIELD_TYPE = [
  "short_text", "long_text", "number", "select_one", "select_many",
  "checkbox", "date", "photo", "file", "signature", "pass_fail_na",
];
const ALLOWED_VERSION_STATUS = ["draft", "published", "archived"];
const ALLOWED_CADENCE = ["daily", "weekly", "biweekly", "monthly", "quarterly"];
const ALLOWED_ASSIGNMENT_STATUS = ["pending", "in_progress", "submitted", "overdue", "cancelled"];

// Validate an assignee_rule JSON payload. We don't fully resolve it
// here (resolution happens in the sweep function at spawn time), but
// we sanity-check the shape so bad rules don't sit in the table
// silently waiting to fail in production.
function validateAssigneeRule(r) {
  if (!r || typeof r !== "object") return "assignee_rule (JSON object) required.";
  const kind = String(r.kind || "");
  if (kind === "fixed") {
    if (!isUuid(r.user_id)) return "assignee_rule.user_id (uuid) required for kind=fixed.";
    return null;
  }
  if (kind === "role_relative") {
    if (typeof r.role !== "string" || !r.role.trim()) return "assignee_rule.role required for kind=role_relative.";
    if (typeof r.anchor !== "string" || !r.anchor.trim()) return "assignee_rule.anchor required for kind=role_relative.";
    return null;
  }
  if (kind === "per_store") {
    const okScopeKind = ["region", "area", "district", "store"].includes(r.scope_kind);
    if (!okScopeKind) return "assignee_rule.scope_kind must be region|area|district|store for kind=per_store.";
    if (!isUuid(r.scope_id)) return "assignee_rule.scope_id (uuid) required for kind=per_store.";
    if (typeof r.role_in_store !== "string" || !r.role_in_store.trim()) {
      return "assignee_rule.role_in_store required for kind=per_store.";
    }
    return null;
  }
  return `assignee_rule.kind must be one of: fixed, role_relative, per_store (got: ${kind}).`;
}

// "HH:MM" with hour 0-23 and minute 0-59. Reject anything else so
// the sweep function never has to parse garbage.
function isValidSpawnTime(s) {
  if (typeof s !== "string") return false;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && mn >= 0 && mn <= 59;
}

// Normalize + validate a question payload from the client. Returns
// { ok: true, row } for an insert-ready object, or { ok: false, msg }
// for a validation error. `position` is set by the caller — we don't
// trust client-supplied positions; array order wins.
function normalizeQuestion(q, position) {
  if (!q || typeof q !== "object") return { ok: false, msg: "question must be an object." };
  const fieldType = String(q.field_type || "").toLowerCase();
  if (!ALLOWED_FIELD_TYPE.includes(fieldType)) {
    return { ok: false, msg: `Bad field_type: ${q.field_type}` };
  }
  const text = String(q.question_text || "").trim();
  if (!text) return { ok: false, msg: "question_text required." };
  // Audit-specific numeric: weight must be >= 0 if present
  let weight = null;
  if (q.weight != null && q.weight !== "") {
    weight = Number(q.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      return { ok: false, msg: "weight must be a non-negative number." };
    }
  }
  return {
    ok: true,
    row: {
      position,
      section_label:        (q.section_label || "").trim() || null,
      question_text:        text,
      field_type:           fieldType,
      is_required:          !!q.is_required,
      weight,
      is_critical:          !!q.is_critical,
      requires_cap_on_fail: !!q.requires_cap_on_fail,
      cap_assignee_rule:    q.cap_assignee_rule || null,
      field_config:         q.field_config || null,
      conditional_logic:    q.conditional_logic || null,
    },
  };
}

// Same shape for approval steps. step_number is set by caller.
function normalizeApprovalStep(s, stepNumber) {
  if (!s || typeof s !== "object") return { ok: false, msg: "step must be an object." };
  const label = String(s.label || "").trim();
  if (!label) return { ok: false, msg: "step label required." };
  if (!s.approver_rule || typeof s.approver_rule !== "object") {
    return { ok: false, msg: "approver_rule (JSON object) required." };
  }
  return {
    ok: true,
    row: {
      step_number:     stepNumber,
      label,
      approver_rule:   s.approver_rule,
      any_can_approve: s.any_can_approve !== false, // default true
    },
  };
}

// Resolve the workspace_id for a given template_id or version_id —
// needed for capability + activity-log calls without a round-trip
// from the caller.
async function workspaceIdForTemplate(supabase, templateId) {
  const { data } = await supabase
    .from("workspace_templates")
    .select("workspace_id")
    .eq("id", templateId)
    .maybeSingle();
  return data?.workspace_id || null;
}
async function workspaceIdForVersion(supabase, versionId) {
  const { data } = await supabase
    .from("workspace_template_versions")
    .select("template_id, workspace_templates:template_id(workspace_id)")
    .eq("id", versionId)
    .maybeSingle();
  return data?.workspace_templates?.workspace_id || null;
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
    // WORKSPACES
    // ═══════════════════════════════════════════════════════════

    // List workspaces the caller can see. Returns minimal columns —
    // the detail screen calls getWorkspace for the full row.
    if (action === "listMine") {
      const includeArchived = (event.queryStringParameters || {}).include_archived === "true";

      let query = supabase
        .from("workspaces")
        .select("id, name, description, visibility, scope_anchor_kind, scope_anchor_id, is_archived, created_at, updated_at")
        .order("name");
      if (!includeArchived) query = query.eq("is_archived", false);

      const vis = await visibleWorkspaceIds(supabase, profile);
      if (!vis.all) {
        if (!vis.ids.length) return respond(200, { ok: true, workspaces: [] });
        query = query.in("id", vis.ids);
      }

      const { data, error } = await query;
      if (error) throw error;
      return respond(200, { ok: true, workspaces: data || [] });
    }

    // Full detail: workspace row + member roster + the caller's own
    // workspace_role (for UI gating).
    if (action === "getWorkspace") {
      const id = (event.queryStringParameters || {}).id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad workspace id." });

      const { data: ws, error: wsErr } = await supabase
        .from("workspaces")
        .select("*")
        .eq("id", id)
        .single();
      if (wsErr || !ws) return respond(404, { ok: false, message: "Workspace not found." });

      // Visibility gate (admin always; everyone else must be in the
      // visible set).
      if (!isOrgAdmin(profile)) {
        const vis = await visibleWorkspaceIds(supabase, profile);
        if (!vis.all && !vis.ids.includes(id)) {
          return respond(403, { ok: false, message: "Not visible to you." });
        }
      }

      const { data: members } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id, workspace_role, added_at, added_by_id, profiles:user_id(full_name, email, role)")
        .eq("workspace_id", id)
        .order("added_at");

      const myRole = await workspaceRoleFor(supabase, profile, id);

      return respond(200, {
        ok: true,
        workspace: ws,
        members: members || [],
        my_workspace_role: myRole,
        my_is_admin: isOrgAdmin(profile),
      });
    }

    if (action === "createWorkspace" && event.httpMethod === "POST") {
      const denied = requireGlobalCap(profile, "create_workspace");
      if (denied) return denied;

      const payload = JSON.parse(event.body || "{}");
      const name = (payload.name || "").trim();
      const description = (payload.description || "").trim() || null;
      const visibility = ALLOWED_VISIBILITY.includes(payload.visibility)
        ? payload.visibility
        : "scoped";

      if (!name) return respond(400, { ok: false, message: "name required." });

      let scopeKind = null, scopeId = null;
      if (payload.scope_anchor_kind || payload.scope_anchor_id) {
        if (!ALLOWED_ANCHOR_KIND.includes(payload.scope_anchor_kind)) {
          return respond(400, { ok: false, message: "Bad scope_anchor_kind." });
        }
        if (!isUuid(payload.scope_anchor_id)) {
          return respond(400, { ok: false, message: "Bad scope_anchor_id." });
        }
        scopeKind = payload.scope_anchor_kind;
        scopeId = payload.scope_anchor_id;
      }

      const { data: ws, error } = await supabase
        .from("workspaces")
        .insert({
          name,
          description,
          visibility,
          scope_anchor_kind: scopeKind,
          scope_anchor_id: scopeId,
          created_by_id: profile.id,
        })
        .select("*")
        .single();
      if (error) throw error;

      // Auto-add the creator as owner.
      await supabase.from("workspace_members").insert({
        workspace_id: ws.id,
        user_id: profile.id,
        workspace_role: "owner",
        added_by_id: profile.id,
      });

      await logActivity(supabase, profile, {
        workspaceId: ws.id,
        targetKind: "workspace",
        targetId: ws.id,
        action: "workspace.created",
        afterState: ws,
      });

      return respond(200, { ok: true, workspace: ws });
    }

    if (action === "updateWorkspace" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad workspace id." });

      const denied = await requireWorkspaceCap(supabase, profile, id, "edit_workspace");
      if (denied) return denied;

      const { data: before } = await supabase
        .from("workspaces").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Workspace not found." });

      const patch = {};
      if (typeof payload.name === "string") {
        const n = payload.name.trim();
        if (!n) return respond(400, { ok: false, message: "name cannot be empty." });
        patch.name = n;
      }
      if ("description" in payload) {
        patch.description = (payload.description || "").trim() || null;
      }
      if (payload.visibility) {
        if (!ALLOWED_VISIBILITY.includes(payload.visibility)) {
          return respond(400, { ok: false, message: "Bad visibility." });
        }
        patch.visibility = payload.visibility;
      }
      // Anchor edits — both must be set or both cleared (matches the
      // workspaces_anchor_paired CHECK constraint).
      if ("scope_anchor_kind" in payload || "scope_anchor_id" in payload) {
        const k = payload.scope_anchor_kind ?? null;
        const i = payload.scope_anchor_id ?? null;
        if ((k === null) !== (i === null)) {
          return respond(400, {
            ok: false,
            message: "scope_anchor_kind and scope_anchor_id must be set or cleared together.",
          });
        }
        if (k !== null && !ALLOWED_ANCHOR_KIND.includes(k)) {
          return respond(400, { ok: false, message: "Bad scope_anchor_kind." });
        }
        if (i !== null && !isUuid(i)) {
          return respond(400, { ok: false, message: "Bad scope_anchor_id." });
        }
        patch.scope_anchor_kind = k;
        patch.scope_anchor_id = i;
      }

      if (!Object.keys(patch).length) {
        return respond(400, { ok: false, message: "Nothing to update." });
      }

      const { data: after, error } = await supabase
        .from("workspaces")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: id,
        targetKind: "workspace",
        targetId: id,
        action: "workspace.updated",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, workspace: after });
    }

    if (
      (action === "archiveWorkspace" || action === "unarchiveWorkspace")
      && event.httpMethod === "POST"
    ) {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad workspace id." });

      const denied = await requireWorkspaceCap(supabase, profile, id, "archive_workspace");
      if (denied) return denied;

      const target = action === "archiveWorkspace";
      const { data: after, error } = await supabase
        .from("workspaces")
        .update({ is_archived: target })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: id,
        targetKind: "workspace",
        targetId: id,
        action: target ? "workspace.archived" : "workspace.unarchived",
        afterState: after,
      });

      return respond(200, { ok: true, workspace: after });
    }

    // Hard delete. Admin-only via the global capability AND the
    // workspace must already be archived as a guardrail (call
    // archiveWorkspace first). Cascades through every child table
    // (templates, submissions, signoffs, CAPs, attachments, automations,
    // and the workspace's own activity_log entries). We write a final
    // orphan log row (workspace_id = NULL) BEFORE the delete so the
    // deletion event survives the cascade.
    if (action === "deleteWorkspace" && event.httpMethod === "POST") {
      const denied = requireGlobalCap(profile, "delete_workspace");
      if (denied) return denied;

      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad workspace id." });

      const { data: before } = await supabase
        .from("workspaces").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Workspace not found." });

      if (!before.is_archived) {
        return respond(400, {
          ok: false,
          message: "Archive the workspace before deleting it. POST archiveWorkspace first.",
        });
      }

      // Orphan-log first — workspace_id NULL so this row survives the
      // cascade. before_state captures what we're deleting; the actor
      // identity snapshot lets future audits reconstruct who did this.
      await logActivity(supabase, profile, {
        workspaceId: null,
        targetKind: "workspace",
        targetId: id,
        action: "workspace.deleted",
        beforeState: before,
        eventData: {
          deleted_workspace_name: before.name,
          deleted_workspace_visibility: before.visibility,
        },
      });

      const { error } = await supabase
        .from("workspaces")
        .delete()
        .eq("id", id);
      if (error) throw error;

      return respond(200, { ok: true });
    }

    // ═══════════════════════════════════════════════════════════
    // MEMBERS
    // ═══════════════════════════════════════════════════════════

    if (action === "listMembers") {
      const wsId = (event.queryStringParameters || {}).workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const { data, error } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id, workspace_role, added_at, added_by_id, profiles:user_id(full_name, email, role)")
        .eq("workspace_id", wsId)
        .order("added_at");
      if (error) throw error;
      return respond(200, { ok: true, members: data || [] });
    }

    if (action === "addMember" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      const userId = payload.user_id;
      const wsRole = payload.workspace_role;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });
      if (!isUuid(userId)) return respond(400, { ok: false, message: "Bad user_id." });
      if (!ALLOWED_MEMBER_ROLE.includes(wsRole)) {
        return respond(400, { ok: false, message: "Bad workspace_role." });
      }

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "manage_members");
      if (denied) return denied;

      // Confirm target profile exists + is active.
      const { data: target } = await supabase
        .from("profiles")
        .select("id, is_active")
        .eq("id", userId)
        .maybeSingle();
      if (!target || !target.is_active) {
        return respond(400, { ok: false, message: "User not found or inactive." });
      }

      // Upsert avoids races and treats "already a member" gracefully.
      const { data, error } = await supabase
        .from("workspace_members")
        .upsert(
          {
            workspace_id: wsId,
            user_id: userId,
            workspace_role: wsRole,
            added_by_id: profile.id,
          },
          { onConflict: "workspace_id,user_id" },
        )
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "member",
        targetId: userId,
        action: "member.added",
        afterState: data,
      });

      return respond(200, { ok: true, member: data });
    }

    if (action === "updateMember" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      const userId = payload.user_id;
      const wsRole = payload.workspace_role;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });
      if (!isUuid(userId)) return respond(400, { ok: false, message: "Bad user_id." });
      if (!ALLOWED_MEMBER_ROLE.includes(wsRole)) {
        return respond(400, { ok: false, message: "Bad workspace_role." });
      }

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "manage_members");
      if (denied) return denied;

      const { data: before } = await supabase
        .from("workspace_members")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!before) return respond(404, { ok: false, message: "Member not found." });

      // Guard the last-owner case: refuse to demote the sole owner.
      if (before.workspace_role === "owner" && wsRole !== "owner") {
        const { count } = await supabase
          .from("workspace_members")
          .select("user_id", { count: "exact", head: true })
          .eq("workspace_id", wsId)
          .eq("workspace_role", "owner");
        if ((count || 0) <= 1) {
          return respond(400, {
            ok: false,
            message: "Cannot demote the only owner. Promote someone else first.",
          });
        }
      }

      const { data: after, error } = await supabase
        .from("workspace_members")
        .update({ workspace_role: wsRole })
        .eq("workspace_id", wsId)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "member",
        targetId: userId,
        action: "member.role_changed",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, member: after });
    }

    if (action === "removeMember" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      const userId = payload.user_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });
      if (!isUuid(userId)) return respond(400, { ok: false, message: "Bad user_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "manage_members");
      if (denied) return denied;

      const { data: before } = await supabase
        .from("workspace_members")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!before) return respond(404, { ok: false, message: "Member not found." });

      // Same last-owner guard as updateMember.
      if (before.workspace_role === "owner") {
        const { count } = await supabase
          .from("workspace_members")
          .select("user_id", { count: "exact", head: true })
          .eq("workspace_id", wsId)
          .eq("workspace_role", "owner");
        if ((count || 0) <= 1) {
          return respond(400, {
            ok: false,
            message: "Cannot remove the only owner. Promote someone else first.",
          });
        }
      }

      const { error } = await supabase
        .from("workspace_members")
        .delete()
        .eq("workspace_id", wsId)
        .eq("user_id", userId);
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "member",
        targetId: userId,
        action: "member.removed",
        beforeState: before,
      });

      return respond(200, { ok: true });
    }

    // ═══════════════════════════════════════════════════════════
    // TEMPLATES
    // ═══════════════════════════════════════════════════════════

    if (action === "listTemplates") {
      const wsId = (event.queryStringParameters || {}).workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const includeArchived = (event.queryStringParameters || {}).include_archived === "true";

      let q = supabase
        .from("workspace_templates")
        .select("*")
        .eq("workspace_id", wsId)
        .order("name");
      if (!includeArchived) q = q.eq("is_archived", false);

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, templates: data || [] });
    }

    // Full template detail: row + every version (with publish state) +
    // question count for the latest published version (or the latest
    // draft if no published yet). Cheap; templates won't have many
    // versions in practice.
    if (action === "getTemplate") {
      const id = (event.queryStringParameters || {}).id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad template id." });

      const { data: tpl, error: tplErr } = await supabase
        .from("workspace_templates")
        .select("*")
        .eq("id", id)
        .single();
      if (tplErr || !tpl) return respond(404, { ok: false, message: "Template not found." });

      const denied = await requireWorkspaceCap(supabase, profile, tpl.workspace_id, "view_workspace");
      if (denied) return denied;

      const { data: versions } = await supabase
        .from("workspace_template_versions")
        .select("*")
        .eq("template_id", id)
        .order("version_number", { ascending: false });

      // Find the "current" version: prefer published, fall back to draft, fall back to archived.
      const current = (versions || []).find((v) => v.status === "published")
                    || (versions || []).find((v) => v.status === "draft")
                    || (versions || [])[0]
                    || null;

      let questionCount = 0;
      if (current) {
        const { count } = await supabase
          .from("workspace_template_questions")
          .select("id", { count: "exact", head: true })
          .eq("version_id", current.id);
        questionCount = count || 0;
      }

      return respond(200, {
        ok: true,
        template: tpl,
        versions: versions || [],
        current_version_id: current?.id || null,
        current_question_count: questionCount,
      });
    }

    // Creates the template + a v1 draft version in one shot. Caller
    // can then immediately upsertQuestions against the new version.
    if (action === "createTemplate" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "create_template");
      if (denied) return denied;

      const name = (payload.name || "").trim();
      if (!name) return respond(400, { ok: false, message: "name required." });
      const description = (payload.description || "").trim() || null;
      const type = ALLOWED_TEMPLATE_TYPE.includes(payload.type) ? payload.type : "form";

      let auditPassThreshold = null;
      let criticalFailsAudit = true;
      if (type === "audit") {
        if (payload.audit_pass_threshold != null) {
          const n = Number(payload.audit_pass_threshold);
          if (!Number.isFinite(n) || n < 0 || n > 100) {
            return respond(400, { ok: false, message: "audit_pass_threshold must be 0-100." });
          }
          auditPassThreshold = n;
        }
        if (typeof payload.critical_fails_audit === "boolean") {
          criticalFailsAudit = payload.critical_fails_audit;
        }
      }

      const { data: tpl, error } = await supabase
        .from("workspace_templates")
        .insert({
          workspace_id: wsId,
          name,
          description,
          type,
          audit_pass_threshold: auditPassThreshold,
          critical_fails_audit: criticalFailsAudit,
          created_by_id: profile.id,
        })
        .select("*")
        .single();
      if (error) throw error;

      // Auto-spawn v1 draft so the caller can immediately add questions.
      const { data: v1, error: vErr } = await supabase
        .from("workspace_template_versions")
        .insert({
          template_id: tpl.id,
          version_number: 1,
          status: "draft",
          created_by_id: profile.id,
        })
        .select("*")
        .single();
      if (vErr) throw vErr;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "template",
        targetId: tpl.id,
        action: "template.created",
        afterState: tpl,
      });
      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "template_version",
        targetId: v1.id,
        action: "template_version.created",
        afterState: v1,
      });

      return respond(200, { ok: true, template: tpl, version: v1 });
    }

    // Patch template metadata. Note: this DOES NOT touch any version
    // contents — it only updates the template header (name, description,
    // type, audit thresholds). Question/step edits go through
    // upsertQuestions / upsertApprovalSteps on a DRAFT version.
    if (action === "updateTemplate" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad template id." });

      const { data: before } = await supabase
        .from("workspace_templates").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Template not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "edit_template");
      if (denied) return denied;

      const patch = {};
      if (typeof payload.name === "string") {
        const n = payload.name.trim();
        if (!n) return respond(400, { ok: false, message: "name cannot be empty." });
        patch.name = n;
      }
      if ("description" in payload) {
        patch.description = (payload.description || "").trim() || null;
      }
      // type changes are allowed but the caller should know what
      // they're doing — switching form↔audit changes how submissions
      // are scored. Existing versions keep their original semantics
      // since template_version_id is the FK on assignments/submissions.
      if (payload.type) {
        if (!ALLOWED_TEMPLATE_TYPE.includes(payload.type)) {
          return respond(400, { ok: false, message: "Bad type." });
        }
        patch.type = payload.type;
      }
      if ("audit_pass_threshold" in payload) {
        if (payload.audit_pass_threshold == null) {
          patch.audit_pass_threshold = null;
        } else {
          const n = Number(payload.audit_pass_threshold);
          if (!Number.isFinite(n) || n < 0 || n > 100) {
            return respond(400, { ok: false, message: "audit_pass_threshold must be 0-100." });
          }
          patch.audit_pass_threshold = n;
        }
      }
      if (typeof payload.critical_fails_audit === "boolean") {
        patch.critical_fails_audit = payload.critical_fails_audit;
      }

      if (!Object.keys(patch).length) {
        return respond(400, { ok: false, message: "Nothing to update." });
      }

      const { data: after, error } = await supabase
        .from("workspace_templates")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "template",
        targetId: id,
        action: "template.updated",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, template: after });
    }

    if (
      (action === "archiveTemplate" || action === "unarchiveTemplate")
      && event.httpMethod === "POST"
    ) {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad template id." });

      const { data: before } = await supabase
        .from("workspace_templates").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Template not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "archive_template");
      if (denied) return denied;

      const target = action === "archiveTemplate";
      const { data: after, error } = await supabase
        .from("workspace_templates")
        .update({ is_archived: target })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "template",
        targetId: id,
        action: target ? "template.archived" : "template.unarchived",
        afterState: after,
      });

      return respond(200, { ok: true, template: after });
    }

    // ═══════════════════════════════════════════════════════════
    // TEMPLATE VERSIONS
    // ═══════════════════════════════════════════════════════════

    if (action === "listTemplateVersions") {
      const tplId = (event.queryStringParameters || {}).template_id;
      if (!isUuid(tplId)) return respond(400, { ok: false, message: "Bad template_id." });

      const wsId = await workspaceIdForTemplate(supabase, tplId);
      if (!wsId) return respond(404, { ok: false, message: "Template not found." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const { data, error } = await supabase
        .from("workspace_template_versions")
        .select("*")
        .eq("template_id", tplId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return respond(200, { ok: true, versions: data || [] });
    }

    // Full version detail: row + questions (ordered) + approval steps.
    if (action === "getTemplateVersion") {
      const vId = (event.queryStringParameters || {}).id;
      if (!isUuid(vId)) return respond(400, { ok: false, message: "Bad version id." });

      const { data: ver, error: vErr } = await supabase
        .from("workspace_template_versions")
        .select("*, workspace_templates:template_id(workspace_id, name, type)")
        .eq("id", vId)
        .single();
      if (vErr || !ver) return respond(404, { ok: false, message: "Version not found." });

      const wsId = ver.workspace_templates?.workspace_id;
      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const [{ data: questions }, { data: steps }] = await Promise.all([
        supabase
          .from("workspace_template_questions")
          .select("*")
          .eq("version_id", vId)
          .order("position"),
        supabase
          .from("workspace_template_approval_steps")
          .select("*")
          .eq("version_id", vId)
          .order("step_number"),
      ]);

      return respond(200, {
        ok: true,
        version: ver,
        questions: questions || [],
        approval_steps: steps || [],
      });
    }

    // Forks a new draft from the current published version (or starts
    // empty if none exists). Carries questions + approval steps into
    // the new draft so the caller can edit-from-base.
    if (action === "createTemplateVersion" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const tplId = payload.template_id;
      if (!isUuid(tplId)) return respond(400, { ok: false, message: "Bad template_id." });

      const wsId = await workspaceIdForTemplate(supabase, tplId);
      if (!wsId) return respond(404, { ok: false, message: "Template not found." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "edit_template");
      if (denied) return denied;

      // Refuse if a draft already exists — one draft at a time.
      // Caller should edit the existing draft or archive it first.
      const { data: existingDraft } = await supabase
        .from("workspace_template_versions")
        .select("id, version_number")
        .eq("template_id", tplId)
        .eq("status", "draft")
        .maybeSingle();
      if (existingDraft) {
        return respond(400, {
          ok: false,
          message: `A draft (v${existingDraft.version_number}) already exists. Edit or archive it first.`,
          existing_draft_id: existingDraft.id,
        });
      }

      // Find the highest version_number so we can bump.
      const { data: latest } = await supabase
        .from("workspace_template_versions")
        .select("id, version_number, status")
        .eq("template_id", tplId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextNum = (latest?.version_number || 0) + 1;

      // Source to fork from: the latest published version (skips
      // archived/draft so we always start from the "live" content).
      const { data: source } = await supabase
        .from("workspace_template_versions")
        .select("id")
        .eq("template_id", tplId)
        .eq("status", "published")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: newVer, error } = await supabase
        .from("workspace_template_versions")
        .insert({
          template_id: tplId,
          version_number: nextNum,
          status: "draft",
          created_by_id: profile.id,
        })
        .select("*")
        .single();
      if (error) throw error;

      // If we have a source, carry its questions + approval steps forward.
      if (source?.id) {
        const { data: srcQuestions } = await supabase
          .from("workspace_template_questions")
          .select("*")
          .eq("version_id", source.id)
          .order("position");
        if (srcQuestions?.length) {
          const rows = srcQuestions.map((q) => ({
            version_id: newVer.id,
            position: q.position,
            section_label: q.section_label,
            question_text: q.question_text,
            field_type: q.field_type,
            is_required: q.is_required,
            weight: q.weight,
            is_critical: q.is_critical,
            requires_cap_on_fail: q.requires_cap_on_fail,
            cap_assignee_rule: q.cap_assignee_rule,
            field_config: q.field_config,
            conditional_logic: q.conditional_logic,
          }));
          await supabase.from("workspace_template_questions").insert(rows);
        }

        const { data: srcSteps } = await supabase
          .from("workspace_template_approval_steps")
          .select("*")
          .eq("version_id", source.id)
          .order("step_number");
        if (srcSteps?.length) {
          const rows = srcSteps.map((s) => ({
            version_id: newVer.id,
            step_number: s.step_number,
            label: s.label,
            approver_rule: s.approver_rule,
            any_can_approve: s.any_can_approve,
          }));
          await supabase.from("workspace_template_approval_steps").insert(rows);
        }
      }

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "template_version",
        targetId: newVer.id,
        action: "template_version.created",
        afterState: newVer,
        eventData: { forked_from_version_id: source?.id || null },
      });

      return respond(200, {
        ok: true,
        version: newVer,
        forked_from_version_id: source?.id || null,
      });
    }

    // Publish a draft. Auto-archives whatever was previously published
    // (one live version at a time per template).
    if (action === "publishTemplateVersion" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const vId = payload.id;
      if (!isUuid(vId)) return respond(400, { ok: false, message: "Bad version id." });

      const { data: ver } = await supabase
        .from("workspace_template_versions")
        .select("*, workspace_templates:template_id(workspace_id)")
        .eq("id", vId)
        .maybeSingle();
      if (!ver) return respond(404, { ok: false, message: "Version not found." });

      const wsId = ver.workspace_templates?.workspace_id;
      const denied = await requireWorkspaceCap(supabase, profile, wsId, "publish_template");
      if (denied) return denied;

      if (ver.status !== "draft") {
        return respond(400, {
          ok: false,
          message: `Can only publish a draft. Current status: ${ver.status}.`,
        });
      }

      // Sanity check: a publishable version must have at least one
      // question. Otherwise it's an empty template.
      const { count: qCount } = await supabase
        .from("workspace_template_questions")
        .select("id", { count: "exact", head: true })
        .eq("version_id", vId);
      if (!qCount) {
        return respond(400, { ok: false, message: "Version has no questions — add at least one before publishing." });
      }

      // Archive whatever was previously published for this template.
      await supabase
        .from("workspace_template_versions")
        .update({ status: "archived" })
        .eq("template_id", ver.template_id)
        .eq("status", "published");

      // Publish this draft.
      const { data: after, error } = await supabase
        .from("workspace_template_versions")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", vId)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "template_version",
        targetId: vId,
        action: "template_version.published",
        beforeState: ver,
        afterState: after,
      });

      return respond(200, { ok: true, version: after });
    }

    // Archive a specific version. Refused if it's the only published
    // version (would leave template with no live content). Drafts can
    // always be archived (effectively a discard).
    if (action === "archiveTemplateVersion" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const vId = payload.id;
      if (!isUuid(vId)) return respond(400, { ok: false, message: "Bad version id." });

      const { data: ver } = await supabase
        .from("workspace_template_versions")
        .select("*, workspace_templates:template_id(workspace_id)")
        .eq("id", vId)
        .maybeSingle();
      if (!ver) return respond(404, { ok: false, message: "Version not found." });

      const wsId = ver.workspace_templates?.workspace_id;
      const denied = await requireWorkspaceCap(supabase, profile, wsId, "edit_template");
      if (denied) return denied;

      if (ver.status === "archived") {
        return respond(400, { ok: false, message: "Already archived." });
      }
      // If archiving the lone published, refuse — caller can publish
      // a different draft first if they want to roll back.
      if (ver.status === "published") {
        const { count } = await supabase
          .from("workspace_template_versions")
          .select("id", { count: "exact", head: true })
          .eq("template_id", ver.template_id)
          .eq("status", "published");
        if ((count || 0) <= 1) {
          return respond(400, {
            ok: false,
            message: "Cannot archive the only published version. Publish a different version first.",
          });
        }
      }

      const { data: after, error } = await supabase
        .from("workspace_template_versions")
        .update({ status: "archived" })
        .eq("id", vId)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "template_version",
        targetId: vId,
        action: "template_version.archived",
        beforeState: ver,
        afterState: after,
      });

      return respond(200, { ok: true, version: after });
    }

    // ═══════════════════════════════════════════════════════════
    // QUESTIONS (full-replace upsert on draft versions only)
    // ═══════════════════════════════════════════════════════════

    if (action === "listQuestions") {
      const vId = (event.queryStringParameters || {}).version_id;
      if (!isUuid(vId)) return respond(400, { ok: false, message: "Bad version_id." });

      const wsId = await workspaceIdForVersion(supabase, vId);
      if (!wsId) return respond(404, { ok: false, message: "Version not found." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const { data, error } = await supabase
        .from("workspace_template_questions")
        .select("*")
        .eq("version_id", vId)
        .order("position");
      if (error) throw error;
      return respond(200, { ok: true, questions: data || [] });
    }

    // Replace the entire question set for a draft version. Server
    // normalizes positions (1..N by array order), validates each
    // question, and applies in a delete+insert pair. Refused on
    // non-draft versions (published / archived are immutable).
    if (action === "upsertQuestions" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const vId = payload.version_id;
      if (!isUuid(vId)) return respond(400, { ok: false, message: "Bad version_id." });
      if (!Array.isArray(payload.questions)) {
        return respond(400, { ok: false, message: "questions[] required." });
      }

      const { data: ver } = await supabase
        .from("workspace_template_versions")
        .select("*, workspace_templates:template_id(workspace_id)")
        .eq("id", vId)
        .maybeSingle();
      if (!ver) return respond(404, { ok: false, message: "Version not found." });

      const wsId = ver.workspace_templates?.workspace_id;
      const denied = await requireWorkspaceCap(supabase, profile, wsId, "edit_template");
      if (denied) return denied;

      if (ver.status !== "draft") {
        return respond(400, {
          ok: false,
          message: `Cannot edit questions on a ${ver.status} version. Fork a new draft first.`,
        });
      }

      // Validate + normalize the whole array first. Reject the entire
      // batch if anything's wrong; partial saves leave gnarly state.
      const rows = [];
      for (let i = 0; i < payload.questions.length; i++) {
        const r = normalizeQuestion(payload.questions[i], i + 1);
        if (!r.ok) {
          return respond(400, { ok: false, message: `Question ${i + 1}: ${r.msg}` });
        }
        rows.push({ ...r.row, version_id: vId });
      }

      // Snapshot old set for the audit log before we wipe it.
      const { data: oldRows } = await supabase
        .from("workspace_template_questions")
        .select("*")
        .eq("version_id", vId)
        .order("position");

      // Replace. (No transaction wrapping via supabase-js, but the
      // version's status='draft' invariant means nothing else points
      // at these rows yet, so the brief gap between delete and insert
      // is safe.)
      await supabase
        .from("workspace_template_questions")
        .delete()
        .eq("version_id", vId);

      let inserted = [];
      if (rows.length) {
        const { data, error } = await supabase
          .from("workspace_template_questions")
          .insert(rows)
          .select("*")
          .order("position");
        if (error) throw error;
        inserted = data || [];
      }

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "template_version",
        targetId: vId,
        action: "template_version.questions_changed",
        beforeState: { question_count: (oldRows || []).length, questions: oldRows || [] },
        afterState: { question_count: inserted.length, questions: inserted },
      });

      return respond(200, { ok: true, questions: inserted });
    }

    // ═══════════════════════════════════════════════════════════
    // APPROVAL STEPS (full-replace upsert on draft versions only)
    // ═══════════════════════════════════════════════════════════

    if (action === "listApprovalSteps") {
      const vId = (event.queryStringParameters || {}).version_id;
      if (!isUuid(vId)) return respond(400, { ok: false, message: "Bad version_id." });

      const wsId = await workspaceIdForVersion(supabase, vId);
      if (!wsId) return respond(404, { ok: false, message: "Version not found." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const { data, error } = await supabase
        .from("workspace_template_approval_steps")
        .select("*")
        .eq("version_id", vId)
        .order("step_number");
      if (error) throw error;
      return respond(200, { ok: true, approval_steps: data || [] });
    }

    if (action === "upsertApprovalSteps" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const vId = payload.version_id;
      if (!isUuid(vId)) return respond(400, { ok: false, message: "Bad version_id." });
      if (!Array.isArray(payload.approval_steps)) {
        return respond(400, { ok: false, message: "approval_steps[] required." });
      }

      const { data: ver } = await supabase
        .from("workspace_template_versions")
        .select("*, workspace_templates:template_id(workspace_id)")
        .eq("id", vId)
        .maybeSingle();
      if (!ver) return respond(404, { ok: false, message: "Version not found." });

      const wsId = ver.workspace_templates?.workspace_id;
      const denied = await requireWorkspaceCap(supabase, profile, wsId, "edit_template");
      if (denied) return denied;

      if (ver.status !== "draft") {
        return respond(400, {
          ok: false,
          message: `Cannot edit approval steps on a ${ver.status} version. Fork a new draft first.`,
        });
      }

      const rows = [];
      for (let i = 0; i < payload.approval_steps.length; i++) {
        const r = normalizeApprovalStep(payload.approval_steps[i], i + 1);
        if (!r.ok) {
          return respond(400, { ok: false, message: `Step ${i + 1}: ${r.msg}` });
        }
        rows.push({ ...r.row, version_id: vId });
      }

      const { data: oldRows } = await supabase
        .from("workspace_template_approval_steps")
        .select("*")
        .eq("version_id", vId)
        .order("step_number");

      await supabase
        .from("workspace_template_approval_steps")
        .delete()
        .eq("version_id", vId);

      let inserted = [];
      if (rows.length) {
        const { data, error } = await supabase
          .from("workspace_template_approval_steps")
          .insert(rows)
          .select("*")
          .order("step_number");
        if (error) throw error;
        inserted = data || [];
      }

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "template_version",
        targetId: vId,
        action: "template_version.approval_steps_changed",
        beforeState: { step_count: (oldRows || []).length, steps: oldRows || [] },
        afterState: { step_count: inserted.length, steps: inserted },
      });

      return respond(200, { ok: true, approval_steps: inserted });
    }

    // ═══════════════════════════════════════════════════════════
    // SCHEDULES
    // ═══════════════════════════════════════════════════════════

    if (action === "listSchedules") {
      const wsId = (event.queryStringParameters || {}).workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const { data, error } = await supabase
        .from("workspace_schedules")
        .select("*, workspace_templates:template_id(name, type)")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return respond(200, { ok: true, schedules: data || [] });
    }

    if (action === "getSchedule") {
      const id = (event.queryStringParameters || {}).id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad schedule id." });

      const { data, error } = await supabase
        .from("workspace_schedules")
        .select("*, workspace_templates:template_id(id, name, type, workspace_id)")
        .eq("id", id)
        .single();
      if (error || !data) return respond(404, { ok: false, message: "Schedule not found." });

      const denied = await requireWorkspaceCap(supabase, profile, data.workspace_id, "view_workspace");
      if (denied) return denied;

      return respond(200, { ok: true, schedule: data });
    }

    if (action === "createSchedule" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      const tplId = payload.template_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });
      if (!isUuid(tplId)) return respond(400, { ok: false, message: "Bad template_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "create_schedule");
      if (denied) return denied;

      // Confirm the template belongs to this workspace (defense against
      // cross-workspace template references).
      const { data: tpl } = await supabase
        .from("workspace_templates")
        .select("workspace_id, is_archived")
        .eq("id", tplId)
        .maybeSingle();
      if (!tpl || tpl.workspace_id !== wsId) {
        return respond(400, { ok: false, message: "Template not in this workspace." });
      }
      if (tpl.is_archived) {
        return respond(400, { ok: false, message: "Cannot schedule against an archived template." });
      }

      const cadence = payload.cadence;
      if (!ALLOWED_CADENCE.includes(cadence)) {
        return respond(400, { ok: false, message: `Bad cadence. Allowed: ${ALLOWED_CADENCE.join(", ")}.` });
      }

      // Cadence-specific required fields. We don't enforce these at the
      // DB level (the CHECK only constrains ranges); the API layer is
      // where we make sure the schedule makes sense.
      let dayOfWeek = null, dayOfMonth = null;
      if (cadence === "weekly" || cadence === "biweekly") {
        if (payload.day_of_week == null) {
          return respond(400, { ok: false, message: "day_of_week (0-6) required for weekly/biweekly cadence." });
        }
        const n = Number(payload.day_of_week);
        if (!Number.isInteger(n) || n < 0 || n > 6) {
          return respond(400, { ok: false, message: "day_of_week must be 0-6 (Sun-Sat)." });
        }
        dayOfWeek = n;
      }
      if (cadence === "monthly" || cadence === "quarterly") {
        if (payload.day_of_month == null) {
          return respond(400, { ok: false, message: "day_of_month (1-28) required for monthly/quarterly cadence." });
        }
        const n = Number(payload.day_of_month);
        if (!Number.isInteger(n) || n < 1 || n > 28) {
          return respond(400, { ok: false, message: "day_of_month must be 1-28 (28 max to dodge month-edge cases)." });
        }
        dayOfMonth = n;
      }

      const spawnTime = payload.spawn_time || "08:00";
      if (!isValidSpawnTime(spawnTime)) {
        return respond(400, { ok: false, message: "spawn_time must be HH:MM (24h)." });
      }
      const spawnTz = (payload.spawn_tz || "America/Chicago").trim();

      const ruleErr = validateAssigneeRule(payload.assignee_rule);
      if (ruleErr) return respond(400, { ok: false, message: ruleErr });

      let dueAfter = 24;
      if (payload.due_after_hours != null) {
        const n = Number(payload.due_after_hours);
        if (!Number.isInteger(n) || n <= 0) {
          return respond(400, { ok: false, message: "due_after_hours must be a positive integer." });
        }
        dueAfter = n;
      }

      // next_spawn_at left NULL on create — the sweep function picks
      // these up on its first run and computes the first occurrence.
      // Allows the admin to create a schedule without us needing to
      // do full TZ math here.
      const { data: sched, error } = await supabase
        .from("workspace_schedules")
        .insert({
          workspace_id: wsId,
          template_id: tplId,
          cadence,
          day_of_week: dayOfWeek,
          day_of_month: dayOfMonth,
          spawn_time: spawnTime,
          spawn_tz: spawnTz,
          assignee_rule: payload.assignee_rule,
          due_after_hours: dueAfter,
          is_active: payload.is_active !== false, // default true
          created_by_id: profile.id,
        })
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "schedule",
        targetId: sched.id,
        action: "schedule.created",
        afterState: sched,
      });

      return respond(200, { ok: true, schedule: sched });
    }

    if (action === "updateSchedule" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad schedule id." });

      const { data: before } = await supabase
        .from("workspace_schedules").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Schedule not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manage_schedule");
      if (denied) return denied;

      const patch = {};
      // Cadence changes are allowed but the day_of_* fields must be
      // consistent. Easiest: re-validate the whole shape using the
      // intended cadence (current or patched).
      const nextCadence = payload.cadence || before.cadence;
      if (payload.cadence && !ALLOWED_CADENCE.includes(payload.cadence)) {
        return respond(400, { ok: false, message: "Bad cadence." });
      }
      if (payload.cadence) patch.cadence = payload.cadence;

      const wantsWeeklyKind = ["weekly", "biweekly"].includes(nextCadence);
      const wantsMonthlyKind = ["monthly", "quarterly"].includes(nextCadence);

      if ("day_of_week" in payload) {
        if (payload.day_of_week == null) {
          if (wantsWeeklyKind) return respond(400, { ok: false, message: "day_of_week required for weekly/biweekly." });
          patch.day_of_week = null;
        } else {
          const n = Number(payload.day_of_week);
          if (!Number.isInteger(n) || n < 0 || n > 6) {
            return respond(400, { ok: false, message: "day_of_week must be 0-6." });
          }
          patch.day_of_week = n;
        }
      }
      if ("day_of_month" in payload) {
        if (payload.day_of_month == null) {
          if (wantsMonthlyKind) return respond(400, { ok: false, message: "day_of_month required for monthly/quarterly." });
          patch.day_of_month = null;
        } else {
          const n = Number(payload.day_of_month);
          if (!Number.isInteger(n) || n < 1 || n > 28) {
            return respond(400, { ok: false, message: "day_of_month must be 1-28." });
          }
          patch.day_of_month = n;
        }
      }
      if ("spawn_time" in payload) {
        if (!isValidSpawnTime(payload.spawn_time)) {
          return respond(400, { ok: false, message: "spawn_time must be HH:MM." });
        }
        patch.spawn_time = payload.spawn_time;
      }
      if ("spawn_tz" in payload) {
        const tz = String(payload.spawn_tz || "").trim();
        if (!tz) return respond(400, { ok: false, message: "spawn_tz cannot be empty." });
        patch.spawn_tz = tz;
      }
      if ("assignee_rule" in payload) {
        const err = validateAssigneeRule(payload.assignee_rule);
        if (err) return respond(400, { ok: false, message: err });
        patch.assignee_rule = payload.assignee_rule;
      }
      if ("due_after_hours" in payload) {
        const n = Number(payload.due_after_hours);
        if (!Number.isInteger(n) || n <= 0) {
          return respond(400, { ok: false, message: "due_after_hours must be a positive integer." });
        }
        patch.due_after_hours = n;
      }
      if (typeof payload.is_active === "boolean") {
        patch.is_active = payload.is_active;
      }

      // If any of cadence/day_of_week/day_of_month/spawn_time/spawn_tz
      // changed, reset next_spawn_at so the sweeper recomputes from
      // the new rule.
      const scheduleFieldsChanged =
        "cadence" in patch || "day_of_week" in patch || "day_of_month" in patch
        || "spawn_time" in patch || "spawn_tz" in patch;
      if (scheduleFieldsChanged) {
        patch.next_spawn_at = null;
      }

      if (!Object.keys(patch).length) {
        return respond(400, { ok: false, message: "Nothing to update." });
      }

      const { data: after, error } = await supabase
        .from("workspace_schedules")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "schedule",
        targetId: id,
        action: "schedule.updated",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, schedule: after });
    }

    // Quick enable/disable without a full update. Convenience for UI
    // toggles. Logs 'schedule.enabled' or 'schedule.disabled' so the
    // audit trail captures the intent rather than a generic .updated.
    if (action === "toggleSchedule" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad schedule id." });
      if (typeof payload.is_active !== "boolean") {
        return respond(400, { ok: false, message: "is_active (boolean) required." });
      }

      const { data: before } = await supabase
        .from("workspace_schedules").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Schedule not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manage_schedule");
      if (denied) return denied;

      if (before.is_active === payload.is_active) {
        return respond(200, { ok: true, schedule: before, unchanged: true });
      }

      const { data: after, error } = await supabase
        .from("workspace_schedules")
        .update({ is_active: payload.is_active })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "schedule",
        targetId: id,
        action: payload.is_active ? "schedule.enabled" : "schedule.disabled",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, schedule: after });
    }

    // Hard delete. Schedules don't carry their own history (audit log
    // does), so deletion is safe. Existing assignments spawned from
    // the schedule keep their schedule_id (FK is ON DELETE SET NULL).
    if (action === "deleteSchedule" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad schedule id." });

      const { data: before } = await supabase
        .from("workspace_schedules").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Schedule not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manage_schedule");
      if (denied) return denied;

      const { error } = await supabase
        .from("workspace_schedules")
        .delete()
        .eq("id", id);
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "schedule",
        targetId: id,
        action: "schedule.disabled",
        beforeState: before,
        eventData: { reason: "deleted" },
      });

      return respond(200, { ok: true });
    }

    // ═══════════════════════════════════════════════════════════
    // ASSIGNMENTS
    // ═══════════════════════════════════════════════════════════

    // Workspace-scoped assignment list with optional status filter.
    // Used by the "tasks in this workspace" admin/owner view.
    if (action === "listAssignments") {
      const wsId = (event.queryStringParameters || {}).workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_workspace");
      if (denied) return denied;

      const status = (event.queryStringParameters || {}).status;
      const assigneeFilter = (event.queryStringParameters || {}).assignee_id;
      const limit = Math.min(
        parseInt((event.queryStringParameters || {}).limit, 10) || 100,
        500,
      );

      let q = supabase
        .from("workspace_assignments")
        .select(`
          *,
          workspace_templates:template_id(id, name, type),
          assignee:assignee_id(id, full_name, email, role),
          store:store_id(id, store_number:number, name)
        `)
        .eq("workspace_id", wsId)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(limit);
      if (status) {
        const statuses = status.split(",").filter((s) => ALLOWED_ASSIGNMENT_STATUS.includes(s));
        if (statuses.length) q = q.in("status", statuses);
      }
      if (assigneeFilter && isUuid(assigneeFilter)) {
        q = q.eq("assignee_id", assigneeFilter);
      }

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, assignments: data || [] });
    }

    // Caller's own assignment queue across ALL workspaces they have
    // assignments in. Default filter: open work (pending + in_progress
    // + overdue) — the "what should I be working on" view.
    if (action === "listMyAssignments") {
      const status = (event.queryStringParameters || {}).status;
      const statuses = status
        ? status.split(",").filter((s) => ALLOWED_ASSIGNMENT_STATUS.includes(s))
        : ["pending", "in_progress", "overdue"];

      const { data, error } = await supabase
        .from("workspace_assignments")
        .select(`
          *,
          workspaces:workspace_id(id, name),
          workspace_templates:template_id(id, name, type),
          store:store_id(id, store_number:number, name)
        `)
        .eq("assignee_id", profile.id)
        .in("status", statuses)
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return respond(200, { ok: true, assignments: data || [] });
    }

    if (action === "getAssignment") {
      const id = (event.queryStringParameters || {}).id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad assignment id." });

      const { data: asn, error } = await supabase
        .from("workspace_assignments")
        .select(`
          *,
          workspace_templates:template_id(id, name, type, audit_pass_threshold, critical_fails_audit),
          workspace_template_versions:template_version_id(id, version_number, status),
          assignee:assignee_id(id, full_name, email, role),
          store:store_id(id, store_number:number, name)
        `)
        .eq("id", id)
        .single();
      if (error || !asn) return respond(404, { ok: false, message: "Assignment not found." });

      // Visible if assignee OR workspace-member.
      const isAssignee = asn.assignee_id === profile.id;
      if (!isAssignee) {
        const denied = await requireWorkspaceCap(supabase, profile, asn.workspace_id, "view_workspace");
        if (denied) return denied;
      }

      return respond(200, { ok: true, assignment: asn });
    }

    // Ad-hoc assignment creation (not via schedule). Pins to the
    // currently-published template version so the assignment can't be
    // rug-pulled by a future publish.
    if (action === "createAssignment" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      const tplId = payload.template_id;
      const assigneeId = payload.assignee_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });
      if (!isUuid(tplId)) return respond(400, { ok: false, message: "Bad template_id." });
      if (!isUuid(assigneeId)) return respond(400, { ok: false, message: "Bad assignee_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "create_assignment");
      if (denied) return denied;

      // Confirm the template is in the workspace + not archived.
      const { data: tpl } = await supabase
        .from("workspace_templates")
        .select("workspace_id, is_archived, type")
        .eq("id", tplId)
        .maybeSingle();
      if (!tpl || tpl.workspace_id !== wsId) {
        return respond(400, { ok: false, message: "Template not in this workspace." });
      }
      if (tpl.is_archived) {
        return respond(400, { ok: false, message: "Template is archived." });
      }

      // Resolve the current published version. If there's no published
      // version yet, we can't create an assignment — the form has no
      // content to fill out.
      const { data: published } = await supabase
        .from("workspace_template_versions")
        .select("id, version_number")
        .eq("template_id", tplId)
        .eq("status", "published")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!published) {
        return respond(400, {
          ok: false,
          message: "Template has no published version. Publish a draft before creating assignments.",
        });
      }

      // Confirm assignee profile exists + is active.
      const { data: assignee } = await supabase
        .from("profiles")
        .select("id, is_active")
        .eq("id", assigneeId)
        .maybeSingle();
      if (!assignee || !assignee.is_active) {
        return respond(400, { ok: false, message: "Assignee not found or inactive." });
      }

      // Optional store_id — if present, validate it exists.
      let storeId = null;
      if (payload.store_id != null) {
        if (!isUuid(payload.store_id)) return respond(400, { ok: false, message: "Bad store_id." });
        const { data: store } = await supabase
          .from("stores").select("id").eq("id", payload.store_id).maybeSingle();
        if (!store) return respond(400, { ok: false, message: "Store not found." });
        storeId = payload.store_id;
      }

      // Optional due_at — ISO 8601 string.
      let dueAt = null;
      if (payload.due_at != null && payload.due_at !== "") {
        const d = new Date(payload.due_at);
        if (isNaN(d.getTime())) return respond(400, { ok: false, message: "due_at must be an ISO 8601 timestamp." });
        dueAt = d.toISOString();
      }

      const { data: asn, error } = await supabase
        .from("workspace_assignments")
        .insert({
          workspace_id: wsId,
          template_id: tplId,
          template_version_id: published.id,
          assignee_id: assigneeId,
          store_id: storeId,
          status: "pending",
          due_at: dueAt,
          created_by_id: profile.id,
        })
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "assignment",
        targetId: asn.id,
        action: "assignment.created",
        afterState: asn,
        eventData: { source: "ad_hoc", template_version_number: published.version_number },
      });

      return respond(200, { ok: true, assignment: asn });
    }

    // Cancel a pending/in_progress assignment. Refused if already
    // submitted (a real submission exists — caller should void the
    // submission via its own flow). Reason is captured in event_data.
    if (action === "cancelAssignment" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad assignment id." });

      const { data: before } = await supabase
        .from("workspace_assignments").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Assignment not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "cancel_assignment");
      if (denied) return denied;

      if (before.status === "submitted") {
        return respond(400, {
          ok: false,
          message: "Already submitted — void the submission instead of cancelling the assignment.",
        });
      }
      if (before.status === "cancelled") {
        return respond(400, { ok: false, message: "Already cancelled." });
      }

      const { data: after, error } = await supabase
        .from("workspace_assignments")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by_id: profile.id,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "assignment",
        targetId: id,
        action: "assignment.cancelled",
        beforeState: before,
        afterState: after,
        eventData: { reason: payload.reason || null },
      });

      return respond(200, { ok: true, assignment: after });
    }

    // Assignee marks an assignment "in_progress" (opened, started
    // filling out). Idempotent: calling on an already-started
    // assignment returns the row unchanged. Refused if not the
    // assignee unless the caller has edit_workspace (admin override).
    if (action === "startAssignment" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad assignment id." });

      const { data: before } = await supabase
        .from("workspace_assignments").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Assignment not found." });

      const isAssignee = before.assignee_id === profile.id;
      if (!isAssignee) {
        // Admin override path — admins can mark something started on
        // someone's behalf (rare, but useful when assignee is e.g.
        // out and someone else is covering the form).
        const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "fill_assignment");
        if (denied) return respond(403, { ok: false, message: "Only the assignee (or workspace editor) can start this." });
      }

      if (before.status === "cancelled") {
        return respond(400, { ok: false, message: "Assignment is cancelled." });
      }
      if (before.status === "submitted") {
        return respond(400, { ok: false, message: "Already submitted." });
      }
      // Already in_progress — return unchanged. Idempotent.
      if (before.status === "in_progress") {
        return respond(200, { ok: true, assignment: before, unchanged: true });
      }

      const { data: after, error } = await supabase
        .from("workspace_assignments")
        .update({
          status: "in_progress",
          started_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "assignment",
        targetId: id,
        action: "assignment.started",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, assignment: after });
    }

    // ═══════════════════════════════════════════════════════════
    // ACTIVITY LOG
    // ═══════════════════════════════════════════════════════════

    // Owner / admin only. Paginated; newest first.
    if (action === "getActivity") {
      const wsId = (event.queryStringParameters || {}).workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "view_activity_log");
      if (denied) return denied;

      const limit = Math.min(
        parseInt((event.queryStringParameters || {}).limit, 10) || 50,
        200,
      );
      const before = (event.queryStringParameters || {}).before; // ISO 8601 cursor

      let q = supabase
        .from("workspace_activity_log")
        .select("*")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (before) q = q.lt("created_at", before);

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, entries: data || [] });
    }

    return respond(404, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error("workspaces handler error:", err);
    return respond(500, {
      ok: false,
      message: err?.message || "Internal server error.",
    });
  }
};
