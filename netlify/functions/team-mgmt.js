// netlify/functions/team-mgmt.js
//
// Phase 2b — My Team backend.
//
// Auth bridge: identical pattern to work-orders.js. Validates the Supabase
// JWT via service-role key, looks up the requesting user's role, and gates
// every action on the centralized manageable_users() rules in
// supabase/migrations/0004_manageable_users.sql.
//
// Actions (this commit ships only ?action=list — write actions land in
// later commits with stricter validation):
//
//   GET /.netlify/functions/team-mgmt?action=list
//     -> { user: <session>, members: <ManageableUser[]> }
//
// ManageableUser shape:
//   {
//     id, email, phone, full_name, role, is_active,
//     scopes: [{ scope_type, scope_id, label }]   // human-readable "Store 4421"
//   }
//
// Required env vars:
//   VITE_SUPABASE_URL              (or SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("team-mgmt env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const supa = admin();
  const { data: userRes, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userRes?.user) return null;

  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;

  return profile;
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

// ----------------------------------------------------------------------------
// list
// ----------------------------------------------------------------------------

async function listManaged(supa, manager) {
  const { data: members, error: rpcErr } = await supa.rpc(
    "manageable_users",
    { manager_id: manager.id }
  );
  if (rpcErr) {
    return { error: `manageable_users failed: ${rpcErr.message}`, status: 500 };
  }
  if (!members || members.length === 0) {
    return { user: manager, members: [] };
  }

  // Pull scopes for every returned user, then resolve scope_id -> human label.
  const ids = members.map((m) => m.id);
  const { data: scopes } = await supa
    .from("user_scopes")
    .select("user_id, scope_type, scope_id")
    .in("user_id", ids);

  const storeIds = (scopes ?? [])
    .filter((s) => s.scope_type === "store")
    .map((s) => s.scope_id);
  const districtIds = (scopes ?? [])
    .filter((s) => s.scope_type === "district")
    .map((s) => s.scope_id);
  const areaIds = (scopes ?? [])
    .filter((s) => s.scope_type === "area")
    .map((s) => s.scope_id);
  const regionIds = (scopes ?? [])
    .filter((s) => s.scope_type === "region")
    .map((s) => s.scope_id);

  const [{ data: stores }, { data: districts }, { data: areas }, { data: regions }] =
    await Promise.all([
      storeIds.length
        ? supa.from("stores").select("id, number, name").in("id", storeIds)
        : Promise.resolve({ data: [] }),
      districtIds.length
        ? supa.from("districts").select("id, name, code").in("id", districtIds)
        : Promise.resolve({ data: [] }),
      areaIds.length
        ? supa.from("areas").select("id, name, code").in("id", areaIds)
        : Promise.resolve({ data: [] }),
      regionIds.length
        ? supa.from("regions").select("id, name, code").in("id", regionIds)
        : Promise.resolve({ data: [] }),
    ]);

  const storeMap = Object.fromEntries((stores ?? []).map((s) => [s.id, s]));
  const districtMap = Object.fromEntries((districts ?? []).map((d) => [d.id, d]));
  const areaMap = Object.fromEntries((areas ?? []).map((a) => [a.id, a]));
  const regionMap = Object.fromEntries((regions ?? []).map((r) => [r.id, r]));

  function labelFor(scope) {
    if (scope.scope_type === "global") return "All stores";
    if (scope.scope_type === "store") {
      const s = storeMap[scope.scope_id];
      return s ? `Store ${s.number}${s.name ? " — " + s.name : ""}` : "Store";
    }
    if (scope.scope_type === "district") {
      const d = districtMap[scope.scope_id];
      return d ? `District ${d.name}` : "District";
    }
    if (scope.scope_type === "area") {
      const a = areaMap[scope.scope_id];
      return a ? `Area ${a.name}` : "Area";
    }
    if (scope.scope_type === "region") {
      const r = regionMap[scope.scope_id];
      return r ? `Region ${r.name}` : "Region";
    }
    return scope.scope_type;
  }

  // Code that round-trips through the bulk-import CSV. For stores we use
  // the store number; for district/area/region we use the .code column;
  // global has no code.
  function codeFor(scope) {
    if (scope.scope_type === "global") return "";
    if (scope.scope_type === "store") {
      const s = storeMap[scope.scope_id];
      return s ? String(s.number) : "";
    }
    if (scope.scope_type === "district") {
      const d = districtMap[scope.scope_id];
      return d?.code ?? "";
    }
    if (scope.scope_type === "area") {
      const a = areaMap[scope.scope_id];
      return a?.code ?? "";
    }
    if (scope.scope_type === "region") {
      const r = regionMap[scope.scope_id];
      return r?.code ?? "";
    }
    return "";
  }

  const scopesByUser = {};
  for (const s of scopes ?? []) {
    (scopesByUser[s.user_id] ||= []).push({
      scope_type: s.scope_type,
      scope_id: s.scope_id,
      label: labelFor(s),
      code: codeFor(s),
    });
  }

  // Pull email_confirmed_at for each member from auth.admin.listUsers so the
  // UI can flag accounts that haven't activated yet (invite sent but link
  // never clicked / password never set). admin.listUsers paginates at 50;
  // 1000 covers anything realistic for our scale today.
  const memberIdSet = new Set(members.map((m) => m.id));
  const confirmedMap = {};
  try {
    let page = 1;
    while (true) {
      const { data: usersPage, error: usersErr } = await supa.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (usersErr) break;
      const users = usersPage?.users ?? [];
      for (const u of users) {
        if (memberIdSet.has(u.id)) {
          confirmedMap[u.id] = u.email_confirmed_at ?? null;
        }
      }
      if (users.length < 200 || page >= 5) break;
      page += 1;
    }
  } catch (e) {
    console.warn("[team-mgmt] failed to enrich with auth.users", e);
  }

  const enriched = members.map((m) => ({
    id: m.id,
    email: m.email,
    phone: m.phone,
    full_name: m.full_name,
    role: m.role,
    is_active: m.is_active,
    email_confirmed_at: confirmedMap[m.id] ?? null,
    scopes: scopesByUser[m.id] ?? [],
  }));

  return { user: manager, members: enriched };
}

// ----------------------------------------------------------------------------
// Permission rules — encoded once, used by add/change/remove
// ----------------------------------------------------------------------------

// Which roles can a manager create / change-to?
function manageableRoles(role) {
  switch (role) {
    case "admin":
      return ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"];
    case "coo":
    case "vp":
      return ["shift_manager", "gm", "do", "sdo", "rvp"];
    case "rvp":
      return ["shift_manager", "gm", "do", "sdo"];
    case "sdo":
    case "do":
      return ["shift_manager", "gm"];
    case "gm":
      return ["shift_manager"];
    default:
      return [];
  }
}

// What scope_type does each new-user role get?
function scopeForRole(role) {
  switch (role) {
    case "shift_manager":
    case "gm":
      return "store";
    case "do":
      return "district";
    case "sdo":
      // SDOs typically oversee a multi-district area; assigning them at
      // area scope gives them visibility across all districts in that area.
      return "area";
    case "rvp":
      return "region";
    case "vp":
    case "coo":
    case "admin":
    case "payroll":
      return "global";
    default:
      return null;
  }
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const trimmed =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return trimmed.length === 10 ? trimmed : null;
}

// ----------------------------------------------------------------------------
// Audit log
// ----------------------------------------------------------------------------
//
// Every successful write to profiles / user_scopes via this function gets a
// matching team_changes row. before/after capture only the fields that
// actually changed so the history view stays readable. We never throw if
// logging fails — the user-facing action already succeeded; we just warn.

async function logChange(supa, { actor_id, target_id, action, before, after }) {
  try {
    await supa.from("team_changes").insert({
      actor_id,
      target_id,
      action,
      before: before ?? null,
      after: after ?? null,
    });
  } catch (e) {
    console.warn("[team-mgmt] audit log insert failed", e);
  }
}

// ----------------------------------------------------------------------------
// scope-options — org tree the manager can see
// ----------------------------------------------------------------------------

async function scopeOptions(supa, manager) {
  // user_visible_stores returns setof uuid (bare values).
  const { data: storeIds } = await supa.rpc("user_visible_stores", {
    uid: manager.id,
  });
  const ids = (storeIds ?? []).map((s) => (typeof s === "string" ? s : s));
  if (ids.length === 0) {
    return { stores: [], districts: [], areas: [], regions: [], canSetGlobal: manager.role === "admin" };
  }

  const { data: stores } = await supa
    .from("stores")
    .select("id, number, name, district_id, is_active")
    .in("id", ids)
    .eq("is_active", true)
    .order("number");

  const districtIds = [...new Set((stores ?? []).map((s) => s.district_id))];
  const { data: districts } = districtIds.length
    ? await supa
        .from("districts")
        .select("id, name, code, area_id")
        .in("id", districtIds)
        .order("name")
    : { data: [] };

  const areaIds = [...new Set((districts ?? []).map((d) => d.area_id))];
  const { data: areas } = areaIds.length
    ? await supa
        .from("areas")
        .select("id, name, code, region_id")
        .in("id", areaIds)
        .order("name")
    : { data: [] };

  const regionIds = [...new Set((areas ?? []).map((a) => a.region_id))];
  const { data: regions } = regionIds.length
    ? await supa
        .from("regions")
        .select("id, name, code")
        .in("id", regionIds)
        .order("name")
    : { data: [] };

  return {
    stores: stores ?? [],
    districts: districts ?? [],
    areas: areas ?? [],
    regions: regions ?? [],
    canSetGlobal: manager.role === "admin",
  };
}

// ----------------------------------------------------------------------------
// add-user — invite + profile + scope, all-or-nothing
// ----------------------------------------------------------------------------

async function resolveStoresForScope(supa, scopeType, scopeId) {
  if (scopeType === "store") return [scopeId];
  if (scopeType === "district") {
    const { data } = await supa.from("stores").select("id").eq("district_id", scopeId);
    return (data ?? []).map((s) => s.id);
  }
  if (scopeType === "area") {
    const { data: districts } = await supa
      .from("districts")
      .select("id")
      .eq("area_id", scopeId);
    const districtIds = (districts ?? []).map((d) => d.id);
    if (!districtIds.length) return [];
    const { data: stores } = await supa
      .from("stores")
      .select("id")
      .in("district_id", districtIds);
    return (stores ?? []).map((s) => s.id);
  }
  if (scopeType === "region") {
    const { data: areas } = await supa
      .from("areas")
      .select("id")
      .eq("region_id", scopeId);
    const areaIds = (areas ?? []).map((a) => a.id);
    if (!areaIds.length) return [];
    const { data: districts } = await supa
      .from("districts")
      .select("id")
      .in("area_id", areaIds);
    const districtIds = (districts ?? []).map((d) => d.id);
    if (!districtIds.length) return [];
    const { data: stores } = await supa
      .from("stores")
      .select("id")
      .in("district_id", districtIds);
    return (stores ?? []).map((s) => s.id);
  }
  return [];
}

async function addUser(supa, manager, body) {
  const full_name = String(body?.full_name ?? "").trim() || null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const rawPhone = body?.phone ? String(body.phone).trim() : null;
  const role = String(body?.role ?? "");
  const scope_type = body?.scope_type ?? null;
  const scope_id = body?.scope_id ?? null;

  // ---- Basic validation ----
  if (!email || !email.includes("@")) {
    return { error: "A valid email is required.", status: 400 };
  }
  if (!role) return { error: "Role is required.", status: 400 };

  // ---- Role permission ----
  const allowed = manageableRoles(manager.role);
  if (!allowed.includes(role)) {
    return {
      error: `Your role can't create users at the "${role}" tier.`,
      status: 403,
    };
  }

  // ---- Scope validation ----
  const expectedScope = scopeForRole(role);
  if (!expectedScope) return { error: "Unknown role.", status: 400 };

  if (expectedScope !== "global" && !scope_id) {
    return { error: "A scope must be selected for this role.", status: 400 };
  }
  if (expectedScope === "global" && manager.role !== "admin") {
    // Only admin can put users at global scope (vp/coo/admin/payroll).
    return {
      error: "Only Admins can create users at this tier.",
      status: 403,
    };
  }

  // For non-admin manager, verify the chosen scope is fully within their reach
  if (manager.role !== "admin" && expectedScope !== "global") {
    const { data: managerStoreIds } = await supa.rpc("user_visible_stores", {
      uid: manager.id,
    });
    const managerSet = new Set(managerStoreIds ?? []);
    const targetStoreIds = await resolveStoresForScope(supa, expectedScope, scope_id);
    if (!targetStoreIds.length) {
      return { error: "That scope has no active stores.", status: 400 };
    }
    if (targetStoreIds.some((id) => !managerSet.has(id))) {
      return { error: "That scope is outside your reach.", status: 403 };
    }
  }

  // ---- Phone shape ----
  let normalizedPhone = null;
  if (rawPhone) {
    normalizedPhone = normalizePhone(rawPhone);
    if (!normalizedPhone) {
      return { error: "Phone must be a 10-digit number.", status: 400 };
    }
  }

  // ---- Send invite. Supabase creates auth.users; trigger creates profiles ----
  // redirectTo lands the user on /accept-invite where they're forced to
  // pick a password before reaching the app. URL is set by Netlify in
  // production; falls back to whatever sent the request.
  const inviteRedirect =
    (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "") +
    "/accept-invite";
  const { data: inviteData, error: inviteErr } =
    await supa.auth.admin.inviteUserByEmail(email, {
      data: full_name ? { full_name } : undefined,
      redirectTo: inviteRedirect || undefined,
    });
  if (inviteErr) {
    if (
      inviteErr.message?.toLowerCase().includes("already") ||
      inviteErr.message?.toLowerCase().includes("registered")
    ) {
      return {
        error: "A user with that email already exists.",
        status: 409,
      };
    }
    return { error: `Invite failed: ${inviteErr.message}`, status: 500 };
  }
  const newUserId = inviteData?.user?.id;
  if (!newUserId) {
    return { error: "Invite returned no user id.", status: 500 };
  }

  // ---- Update the auto-created profile with the real role + phone + name ----
  const { error: profileErr } = await supa
    .from("profiles")
    .update({
      full_name,
      phone: normalizedPhone,
      role,
      is_active: true,
    })
    .eq("id", newUserId);
  if (profileErr) {
    // Best-effort cleanup so we don't leave a half-set-up account
    await supa.auth.admin.deleteUser(newUserId).catch(() => {});
    return {
      error: `Profile setup failed: ${profileErr.message}`,
      status: 500,
    };
  }

  // ---- Insert the scope row ----
  const { error: scopeErr } = await supa.from("user_scopes").insert({
    user_id: newUserId,
    scope_type: expectedScope,
    scope_id: expectedScope === "global" ? null : scope_id,
  });
  if (scopeErr) {
    await supa.auth.admin.deleteUser(newUserId).catch(() => {});
    return {
      error: `Scope assignment failed: ${scopeErr.message}`,
      status: 500,
    };
  }

  // ---- Audit log ----
  await logChange(supa, {
    actor_id: manager.id,
    target_id: newUserId,
    action: "create",
    before: null,
    after: {
      email,
      full_name,
      phone: normalizedPhone,
      role,
      scope_type: expectedScope,
      scope_id: expectedScope === "global" ? null : scope_id,
    },
  });

  return { ok: true, user_id: newUserId, email };
}

// ----------------------------------------------------------------------------
// update-user — change role / scope / phone / active state
// ----------------------------------------------------------------------------
//
// Single endpoint for all post-create edits. Fields are partial — send only
// what you're changing. Server enforces:
//   - target must be in manager's manageable_users() set
//   - new role must be in manager's manageableRoles
//   - scope must match the target role's expected scope_type AND be within
//     the manager's reach (admin bypasses reach check)
//   - is_active=true (reactivation) is admin-only
//   - manager cannot edit themselves through this endpoint
//
// Scope is replaced wholesale (single-scope model). The current single-scope
// row is deleted, the new one inserted. Multi-scope users get edited
// directly in SQL until we expose multi-scope UI.

async function updateUser(supa, manager, body) {
  const target_id = body?.user_id;
  if (!target_id) return { error: "user_id is required.", status: 400 };
  if (target_id === manager.id) {
    return {
      error: "You can't change your own role from My Team. Ask an admin.",
      status: 403,
    };
  }

  // Confirm target is in manager's reach.
  const { data: managed, error: rpcErr } = await supa.rpc("manageable_users", {
    manager_id: manager.id,
  });
  if (rpcErr) return { error: rpcErr.message, status: 500 };
  const target = (managed ?? []).find((m) => m.id === target_id);
  if (!target) {
    return { error: "That user isn't in your scope.", status: 403 };
  }

  // ---- Build the profile-table update piecewise ----
  const updates = {};

  // Role change
  let effectiveRole = target.role;
  if (body.role !== undefined && body.role !== target.role) {
    const allowed = manageableRoles(manager.role);
    if (!allowed.includes(body.role)) {
      return {
        error: `Your role can't change someone to "${body.role}".`,
        status: 403,
      };
    }
    updates.role = body.role;
    effectiveRole = body.role;
  }

  // Phone change (null/empty = clear)
  if (body.phone !== undefined) {
    if (body.phone === null || String(body.phone).trim() === "") {
      updates.phone = null;
    } else {
      const normalized = normalizePhone(body.phone);
      if (!normalized) {
        return { error: "Phone must be a 10-digit number.", status: 400 };
      }
      updates.phone = normalized;
    }
  }

  // Full name change
  if (body.full_name !== undefined) {
    const trimmed = String(body.full_name).trim();
    updates.full_name = trimmed || null;
  }

  // Active state
  if (body.is_active !== undefined && body.is_active !== target.is_active) {
    if (body.is_active === true && manager.role !== "admin") {
      return {
        error: "Only Admins can reactivate users.",
        status: 403,
      };
    }
    updates.is_active = body.is_active;
  }

  // ---- Scope change (full replacement) ----
  let newScope = null;
  if (body.scope_type !== undefined || body.scope_id !== undefined) {
    const expectedScope = scopeForRole(effectiveRole);
    const submittedScope = body.scope_type ?? expectedScope;
    if (submittedScope !== expectedScope) {
      return {
        error: `Scope type "${submittedScope}" doesn't match the role "${effectiveRole}".`,
        status: 400,
      };
    }
    if (expectedScope !== "global" && !body.scope_id) {
      return { error: "A scope must be selected.", status: 400 };
    }
    if (expectedScope === "global" && manager.role !== "admin") {
      return {
        error: "Only Admins can set users to global scope.",
        status: 403,
      };
    }
    if (manager.role !== "admin" && expectedScope !== "global") {
      const { data: managerStoreIds } = await supa.rpc("user_visible_stores", {
        uid: manager.id,
      });
      const set = new Set(managerStoreIds ?? []);
      const targetStores = await resolveStoresForScope(
        supa,
        expectedScope,
        body.scope_id
      );
      if (!targetStores.length) {
        return { error: "That scope has no active stores.", status: 400 };
      }
      if (targetStores.some((id) => !set.has(id))) {
        return { error: "That scope is outside your reach.", status: 403 };
      }
    }
    newScope = {
      scope_type: expectedScope,
      scope_id: expectedScope === "global" ? null : body.scope_id,
    };
  }

  // Capture the previous scope before any changes — needed for audit diff
  const { data: oldScopes } = await supa
    .from("user_scopes")
    .select("scope_type, scope_id")
    .eq("user_id", target_id);
  const oldScopeRow = oldScopes?.[0] ?? null;

  // Apply profile-row updates
  if (Object.keys(updates).length > 0) {
    const { error: profileErr } = await supa
      .from("profiles")
      .update(updates)
      .eq("id", target_id);
    if (profileErr) {
      return {
        error: `Update failed: ${profileErr.message}`,
        status: 500,
      };
    }
  }

  // Apply scope replacement if we received one
  if (newScope) {
    const { error: delErr } = await supa
      .from("user_scopes")
      .delete()
      .eq("user_id", target_id);
    if (delErr) {
      return {
        error: `Couldn't clear old scope: ${delErr.message}`,
        status: 500,
      };
    }
    const { error: insErr } = await supa.from("user_scopes").insert({
      user_id: target_id,
      scope_type: newScope.scope_type,
      scope_id: newScope.scope_id,
    });
    if (insErr) {
      return {
        error: `Couldn't set new scope: ${insErr.message}`,
        status: 500,
      };
    }
  }

  // ---- Audit: figure out which action this update best represents ----
  const before = {};
  const after = {};

  if ("role" in updates) {
    before.role = target.role;
    after.role = updates.role;
  }
  if ("full_name" in updates) {
    before.full_name = target.full_name ?? null;
    after.full_name = updates.full_name;
  }
  if ("phone" in updates) {
    before.phone = target.phone ?? null;
    after.phone = updates.phone;
  }
  if (newScope) {
    before.scope = oldScopeRow ?? null;
    after.scope = newScope;
  }

  let auditAction = null;
  if ("is_active" in updates) {
    auditAction = updates.is_active ? "reactivate" : "deactivate";
    before.is_active = target.is_active;
    after.is_active = updates.is_active;
  } else if (Object.keys(after).length > 0) {
    auditAction = "update";
  }

  if (auditAction) {
    await logChange(supa, {
      actor_id: manager.id,
      target_id,
      action: auditAction,
      before,
      after,
    });
  }

  return { ok: true };
}

// ----------------------------------------------------------------------------
// send-reset — manager triggers a password-reset email to a managed user
// ----------------------------------------------------------------------------
//
// Same Supabase API as the self-serve "Forgot password?" link on the login
// page — the only difference is who initiated it. Server-side scope check:
// the target must be in the manager's manageable_users() set.
//
// We do NOT require the manager to have any "extra" privilege beyond the
// existing Edit-member ones; if you can change someone's role you can also
// poke a recovery email at them.

async function sendReset(supa, manager, body) {
  const target_id = body?.user_id;
  if (!target_id) return { error: "user_id is required.", status: 400 };

  // Fast path — the manager is themselves, allow it
  if (target_id !== manager.id) {
    const { data: managed } = await supa.rpc("manageable_users", {
      manager_id: manager.id,
    });
    const ok = (managed ?? []).some((m) => m.id === target_id);
    if (!ok) return { error: "That user isn't in your scope.", status: 403 };
  }

  // Look up the canonical email for the target.
  const { data: target } = await supa
    .from("profiles")
    .select("email, is_active")
    .eq("id", target_id)
    .maybeSingle();
  if (!target) return { error: "User not found.", status: 404 };
  if (!target.is_active) {
    return {
      error: "That user is inactive. Reactivate before sending a reset.",
      status: 400,
    };
  }

  // Resolve the redirect URL the email should bounce to. URL is set by
  // Netlify in production; fall back to whatever the request came from.
  const redirectTo =
    (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "") +
      "/reset-password" || undefined;

  const { error } = await supa.auth.resetPasswordForEmail(target.email, {
    redirectTo: redirectTo || undefined,
  });
  if (error) return { error: `Send failed: ${error.message}`, status: 500 };

  return { ok: true, sent_to: target.email };
}

// ----------------------------------------------------------------------------
// history — recent audit entries for a user (or any manageable user)
// ----------------------------------------------------------------------------
//
// Admin: any target. Other manager roles: only targets in their
// manageable_users set, or themselves (so anyone can see "what happened to
// me"). Everyone else: 403.

async function fetchHistory(supa, manager, query) {
  const targetId = query?.user_id || null;
  const limit = Math.min(parseInt(query?.limit || "20", 10) || 20, 100);

  // Authorize the target
  if (targetId) {
    if (targetId !== manager.id && manager.role !== "admin") {
      const { data: managed } = await supa.rpc("manageable_users", {
        manager_id: manager.id,
      });
      const ok = (managed ?? []).some((m) => m.id === targetId);
      if (!ok) return { error: "That user isn't in your scope.", status: 403 };
    }
  } else {
    // No target → admin-only org-wide feed (rare)
    if (manager.role !== "admin") {
      return { error: "Specify user_id.", status: 400 };
    }
  }

  let q = supa
    .from("team_changes")
    .select("id, actor_id, target_id, action, before, after, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (targetId) q = q.eq("target_id", targetId);

  const { data: rows, error } = await q;
  if (error) return { error: error.message, status: 500 };
  if (!rows || rows.length === 0) return { entries: [] };

  // Resolve actor names so the UI doesn't need a second query
  const actorIds = [...new Set(rows.map((r) => r.actor_id))];
  const { data: actors } = await supa
    .from("profiles")
    .select("id, full_name, email")
    .in("id", actorIds);
  const actorMap = Object.fromEntries((actors ?? []).map((a) => [a.id, a]));

  return {
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      created_at: r.created_at,
      actor: {
        id: r.actor_id,
        full_name: actorMap[r.actor_id]?.full_name ?? null,
        email: actorMap[r.actor_id]?.email ?? null,
      },
      before: r.before,
      after: r.after,
    })),
  };
}

// ----------------------------------------------------------------------------
// Bulk import — preview + commit (admin only)
// ----------------------------------------------------------------------------
//
// Two-step CSV import. The client parses the CSV, sends rows[] to
// ?action=bulk-preview which validates each row server-side (org refs
// resolved, role/scope alignment, phone shape, duplicate emails) and
// returns annotated rows. The user reviews, then ?action=bulk-import
// runs invites for valid rows only.

const ALL_ROLES = ["shift_manager","gm","do","sdo","rvp","vp","coo","admin","payroll"];

async function bulkValidate(supa, rows) {
  // Pre-load org maps so we can resolve codes → ids in O(1).
  const [
    { data: stores },
    { data: districts },
    { data: areas },
    { data: regions },
  ] = await Promise.all([
    supa.from("stores").select("id, number"),
    supa.from("districts").select("id, code"),
    supa.from("areas").select("id, code"),
    supa.from("regions").select("id, code"),
  ]);
  const storeByNum  = Object.fromEntries((stores ?? []).map((s) => [String(s.number), s.id]));
  const districtByCode = Object.fromEntries((districts ?? []).map((d) => [d.code, d.id]));
  const areaByCode  = Object.fromEntries((areas ?? []).map((a) => [a.code, a.id]));
  const regionByCode= Object.fromEntries((regions ?? []).map((r) => [r.code, r.id]));

  // Pre-load existing emails so we can mark duplicates upfront.
  const existingEmails = new Set();
  try {
    let page = 1;
    while (true) {
      const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      for (const u of data?.users ?? []) {
        if (u.email) existingEmails.add(u.email.toLowerCase());
      }
      if ((data?.users ?? []).length < 200 || page >= 10) break;
      page += 1;
    }
  } catch (e) {
    console.warn("[team-mgmt] bulkValidate: listUsers failed", e);
  }

  const seenEmails = new Set();
  return rows.map((row, i) => {
    const errors = [];
    const warnings = [];
    const email = String(row.email ?? "").trim().toLowerCase();
    const fullName = String(row.full_name ?? "").trim() || null;
    const role = String(row.role ?? "").trim();
    const scopeType = String(row.scope_type ?? "").trim();
    const codeRaw = String(row.scope_id_or_code ?? "").trim();

    if (!email || !email.includes("@")) errors.push("Invalid email.");
    if (!ALL_ROLES.includes(role)) errors.push(`Invalid role "${role}".`);

    const expectedScope = scopeForRole(role);
    if (expectedScope && scopeType !== expectedScope) {
      errors.push(`Role ${role} expects scope_type "${expectedScope}", got "${scopeType}".`);
    }

    let scopeId = null;
    if (scopeType === "global") {
      // ok
    } else if (!codeRaw) {
      errors.push(`scope_id_or_code required for scope_type "${scopeType}".`);
    } else if (scopeType === "store") {
      scopeId = storeByNum[codeRaw];
      if (!scopeId) errors.push(`Store number "${codeRaw}" not found.`);
    } else if (scopeType === "district") {
      scopeId = districtByCode[codeRaw];
      if (!scopeId) errors.push(`District code "${codeRaw}" not found.`);
    } else if (scopeType === "area") {
      scopeId = areaByCode[codeRaw];
      if (!scopeId) errors.push(`Area code "${codeRaw}" not found.`);
    } else if (scopeType === "region") {
      scopeId = regionByCode[codeRaw];
      if (!scopeId) errors.push(`Region code "${codeRaw}" not found.`);
    } else if (!errors.length) {
      errors.push(`Unknown scope_type "${scopeType}".`);
    }

    let phone = null;
    if (row.phone) {
      phone = normalizePhone(row.phone);
      if (!phone) errors.push("Phone must be a 10-digit number.");
    }

    if (email) {
      if (seenEmails.has(email)) errors.push("Duplicate email in this CSV.");
      seenEmails.add(email);
      if (existingEmails.has(email)) {
        warnings.push("Email already in the system — will be skipped.");
      }
    }

    return {
      row: i + 1,
      email,
      full_name: fullName,
      phone,
      role,
      scope_type: scopeType,
      scope_id: scopeId,
      scope_code: codeRaw,
      errors,
      warnings,
      already_exists: existingEmails.has(email),
    };
  });
}

async function bulkPreview(supa, manager, body) {
  if (manager.role !== "admin") {
    return { error: "Bulk import is admin-only.", status: 403 };
  }
  const rows = body?.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "No rows to preview.", status: 400 };
  }
  if (rows.length > 500) {
    return { error: "Bulk import is capped at 500 rows per upload.", status: 400 };
  }
  const annotated = await bulkValidate(supa, rows);
  const summary = {
    total: annotated.length,
    valid: annotated.filter((r) => r.errors.length === 0 && !r.already_exists).length,
    invalid: annotated.filter((r) => r.errors.length > 0).length,
    skipped: annotated.filter((r) => r.errors.length === 0 && r.already_exists).length,
  };
  return { rows: annotated, summary };
}

async function bulkImport(supa, manager, body) {
  if (manager.role !== "admin") {
    return { error: "Bulk import is admin-only.", status: 403 };
  }
  const rows = body?.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "No rows to import.", status: 400 };
  }
  const annotated = await bulkValidate(supa, rows);
  const inviteRedirect =
    (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "") +
      "/accept-invite";

  const results = [];
  for (const r of annotated) {
    if (r.errors.length > 0) {
      results.push({ ...r, status: "error", message: r.errors.join("; ") });
      continue;
    }
    if (r.already_exists) {
      results.push({ ...r, status: "skipped", message: "already exists" });
      continue;
    }
    try {
      const { data: inviteData, error: inviteErr } =
        await supa.auth.admin.inviteUserByEmail(r.email, {
          data: r.full_name ? { full_name: r.full_name } : undefined,
          redirectTo: inviteRedirect || undefined,
        });
      if (inviteErr) {
        results.push({ ...r, status: "error", message: inviteErr.message });
        continue;
      }
      const newUserId = inviteData?.user?.id;
      if (!newUserId) {
        results.push({ ...r, status: "error", message: "no user id returned" });
        continue;
      }

      const { error: profileErr } = await supa
        .from("profiles")
        .update({
          full_name: r.full_name,
          phone: r.phone,
          role: r.role,
          is_active: true,
        })
        .eq("id", newUserId);
      if (profileErr) {
        await supa.auth.admin.deleteUser(newUserId).catch(() => {});
        results.push({ ...r, status: "error", message: profileErr.message });
        continue;
      }

      const { error: scopeErr } = await supa.from("user_scopes").insert({
        user_id: newUserId,
        scope_type: r.scope_type,
        scope_id: r.scope_type === "global" ? null : r.scope_id,
      });
      if (scopeErr) {
        await supa.auth.admin.deleteUser(newUserId).catch(() => {});
        results.push({ ...r, status: "error", message: scopeErr.message });
        continue;
      }

      await logChange(supa, {
        actor_id: manager.id,
        target_id: newUserId,
        action: "create",
        before: null,
        after: {
          email: r.email,
          full_name: r.full_name,
          phone: r.phone,
          role: r.role,
          scope_type: r.scope_type,
          scope_id: r.scope_type === "global" ? null : r.scope_id,
        },
      });
      results.push({ ...r, status: "invited", user_id: newUserId });
    } catch (e) {
      results.push({ ...r, status: "error", message: String(e?.message ?? e) });
    }
  }

  const summary = {
    total: results.length,
    invited: results.filter((r) => r.status === "invited").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
  };
  return { results, summary };
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------

function unwrap(result) {
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    "error" in result
  ) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let manager;
  try {
    manager = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!manager) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";

  try {
    const supa = admin();

    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listManaged(supa, manager));
      if (action === "scope-options") {
        return unwrap(await scopeOptions(supa, manager));
      }
      if (action === "manageable-roles") {
        // tiny helper for the UI's role dropdown
        return respond(200, { roles: manageableRoles(manager.role) });
      }
      if (action === "history") {
        return unwrap(await fetchHistory(supa, manager, params));
      }
      return respond(400, { error: `unknown GET action: ${action}` });
    }

    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "add-user") return unwrap(await addUser(supa, manager, body));
      if (action === "update-user") return unwrap(await updateUser(supa, manager, body));
      if (action === "send-reset") return unwrap(await sendReset(supa, manager, body));
      if (action === "bulk-preview") return unwrap(await bulkPreview(supa, manager, body));
      if (action === "bulk-import") return unwrap(await bulkImport(supa, manager, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }

    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
