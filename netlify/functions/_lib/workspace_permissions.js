// netlify/functions/_lib/workspace_permissions.js
//
// Capability map for the Workspace feature. Parallels _lib/permissions.js
// (WO2) but handles two orthogonal dimensions:
//
//   1. ORG TIER (org-role-based) — who can ever do this in ANY workspace.
//      Gates things like "can create a workspace at all" or "can see
//      every workspace in the org" (admin/payroll bypass).
//
//   2. WORKSPACE ROLE (per-workspace membership) — who can do this in
//      a SPECIFIC workspace. Stored on workspace_members.workspace_role:
//      owner / editor / submitter / viewer.
//
// Most actions check both: ORG tier first (always-yes for admin), then
// WORKSPACE role for non-admin callers. Helpers wrap the common flows.

// ── Org tier (org-role → tier) ────────────────────────────────
//
// Mirrors the WO2 tier map but adds an explicit 'do_plus' tier so we
// can express "DO and above can create workspaces" cleanly.
const ORG_TIER = {
  shift_manager:           "store",
  first_assistant_manager: "store",
  associate_manager:       "store",
  crew_leader:             "store",
  crew_member:             "store",
  carhop:                  "store",
  gm:            "store",
  do:            "do",
  sdo:           "do_plus",
  rvp:           "do_plus",
  vp:            "do_plus",
  coo:           "admin",
  admin:         "admin",
  payroll:       "admin",   // payroll has read-everything visibility
};

export function orgTierFor(role) {
  if (!role) return null;
  return ORG_TIER[String(role).toLowerCase()] || null;
}

export function isOrgAdmin(profile) {
  return orgTierFor(profile?.role) === "admin";
}

// ── Global (org-tier) capabilities ─────────────────────────────
//
// Capabilities not tied to a specific workspace. Anything not in this
// map is implicitly forbidden at the global level — fails closed.
const GLOBAL_CAPS = {
  // Anyone DO+ can stand up a new workspace. They become its owner
  // automatically. (Lower tiers can't seed; rely on someone DO+ adding
  // them as a member.)
  create_workspace:     ["do", "do_plus", "admin"],

  // Admin-only knobs:
  list_all_workspaces:  ["admin"],
  // Hard delete is destructive — admin-only. Cascades through every
  // child table (templates, submissions, CAPs, etc.). The handler
  // additionally requires the workspace to be archived first as a
  // guardrail, but at the capability level admin is the gate.
  delete_workspace:     ["admin"],
};

export function canGlobal(profile, capability) {
  if (!GLOBAL_CAPS[capability]) {
    throw new Error(`Unknown global capability: ${capability}`);
  }
  const tier = orgTierFor(profile?.role);
  return !!tier && GLOBAL_CAPS[capability].includes(tier);
}

export function requireGlobalCap(profile, capability) {
  if (canGlobal(profile, capability)) return null;
  return {
    statusCode: 403,
    body: JSON.stringify({
      ok: false,
      error: "insufficient_global_capability",
      capability,
    }),
    headers: { "Content-Type": "application/json" },
  };
}

// ── Per-workspace capabilities (by workspace_role) ──────────
//
// Keys are workspace-scoped capabilities; values list workspace_roles
// that satisfy them. Admin org-tier bypasses these (handled by the
// helper below) — admins can do anything in any workspace.
const WORKSPACE_CAPS = {
  // Workspace settings + lifecycle:
  view_workspace:         ["owner", "editor", "submitter", "viewer"],
  edit_workspace:         ["owner"],
  archive_workspace:      ["owner"],
  manage_members:         ["owner"],
  view_activity_log:      ["owner"],

  // Template authoring:
  create_template:        ["owner", "editor"],
  edit_template:          ["owner", "editor"],
  archive_template:       ["owner", "editor"],
  publish_template:       ["owner", "editor"],

  // Schedules + assignments:
  create_schedule:        ["owner", "editor"],
  manage_schedule:        ["owner", "editor"],
  create_assignment:      ["owner", "editor"],
  cancel_assignment:      ["owner", "editor"],
  fill_assignment:        ["owner", "editor", "submitter"],

  // Submissions:
  view_submissions:       ["owner", "editor", "viewer", "submitter"],
  unlock_submission:      ["owner"],

  // CAPs:
  view_caps:              ["owner", "editor", "viewer", "submitter"],
  manually_create_cap:    ["owner", "editor"],
  reassign_cap:           ["owner", "editor"],

  // Automations:
  manage_automation:      ["owner"],
};

// Resolve the caller's workspace_role for a given workspace, or null
// if they have no membership row.
export async function workspaceRoleFor(supabase, profile, workspaceId) {
  if (!profile?.id || !workspaceId) return null;
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (error) return null;
  return data?.workspace_role || null;
}

// Check a workspace-scoped capability. Admin org-tier ALWAYS passes
// (cross-cutting admin bypass). Otherwise, the caller's workspace_role
// must be in the allow list for the capability.
export async function canInWorkspace(supabase, profile, workspaceId, capability) {
  if (!WORKSPACE_CAPS[capability]) {
    throw new Error(`Unknown workspace capability: ${capability}`);
  }
  if (isOrgAdmin(profile)) return true;
  const role = await workspaceRoleFor(supabase, profile, workspaceId);
  if (!role) return false;
  return WORKSPACE_CAPS[capability].includes(role);
}

// Convenience: returns a 403 response object if the caller lacks the
// capability, or null if they have it. Mirrors requireCap() from WO2.
export async function requireWorkspaceCap(
  supabase,
  profile,
  workspaceId,
  capability,
) {
  if (await canInWorkspace(supabase, profile, workspaceId, capability)) {
    return null;
  }
  return {
    statusCode: 403,
    body: JSON.stringify({
      ok: false,
      error: "insufficient_workspace_capability",
      capability,
    }),
    headers: { "Content-Type": "application/json" },
  };
}
