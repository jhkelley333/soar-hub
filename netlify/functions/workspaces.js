// netlify/functions/workspaces.js
//
// REST handler for the Workspace feature (forms + audits + CAPs +
// automations). Supabase Bearer-JWT auth, service-role client.
//
// This slice covers the foundation layer (phase 0058):
//   - workspaces:    listMine, getWorkspace, createWorkspace,
//                    updateWorkspace, archiveWorkspace, unarchiveWorkspace,
//                    deleteWorkspace  (admin-only hard delete)
//   - members:       listMembers, addMember, updateMember, removeMember
//   - activity log:  getActivity  (owner / admin only)
//
// Templates, assignments, submissions, CAPs, and automations get added
// in follow-up slices as we work through each domain.
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

// ── Activity log helper ────────────────────────────────────
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

// ── Visibility resolution ──────────────────────────────────
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

// ── Validation helpers ───────────────────────────────────
function isUuid(s) {
  return typeof s === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const ALLOWED_VISIBILITY = ["private", "scoped", "organization"];
const ALLOWED_ANCHOR_KIND = ["region", "area", "district", "store"];
const ALLOWED_MEMBER_ROLE = ["owner", "editor", "submitter", "viewer"];

// ── Handler ──────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  const profile = await getCallerProfile(event);
  if (!profile) {
    return respond(401, { ok: false, message: "Not authenticated." });
  }

  const action = (event.queryStringParameters || {}).action || "";
  const supabase = getSupabase();

  try {
    // ════════════════════════════════════════════════════════════
    // WORKSPACES
    // ════════════════════════════════════════════════════════════

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

    // ════════════════════════════════════════════════════════════
    // MEMBERS
    // ════════════════════════════════════════════════════════════

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

    // ════════════════════════════════════════════════════════════
    // ACTIVITY LOG
    // ════════════════════════════════════════════════════════════

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
