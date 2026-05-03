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
  const marketIds = (scopes ?? [])
    .filter((s) => s.scope_type === "market")
    .map((s) => s.scope_id);
  const regionIds = (scopes ?? [])
    .filter((s) => s.scope_type === "region")
    .map((s) => s.scope_id);

  const [{ data: stores }, { data: districts }, { data: markets }, { data: regions }] =
    await Promise.all([
      storeIds.length
        ? supa.from("stores").select("id, number, name").in("id", storeIds)
        : Promise.resolve({ data: [] }),
      districtIds.length
        ? supa.from("districts").select("id, name, code").in("id", districtIds)
        : Promise.resolve({ data: [] }),
      marketIds.length
        ? supa.from("markets").select("id, name, code").in("id", marketIds)
        : Promise.resolve({ data: [] }),
      regionIds.length
        ? supa.from("regions").select("id, name, code").in("id", regionIds)
        : Promise.resolve({ data: [] }),
    ]);

  const storeMap = Object.fromEntries((stores ?? []).map((s) => [s.id, s]));
  const districtMap = Object.fromEntries((districts ?? []).map((d) => [d.id, d]));
  const marketMap = Object.fromEntries((markets ?? []).map((m) => [m.id, m]));
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
    if (scope.scope_type === "market") {
      const m = marketMap[scope.scope_id];
      return m ? `Market ${m.name}` : "Market";
    }
    if (scope.scope_type === "region") {
      const r = regionMap[scope.scope_id];
      return r ? `Region ${r.name}` : "Region";
    }
    return scope.scope_type;
  }

  const scopesByUser = {};
  for (const s of scopes ?? []) {
    (scopesByUser[s.user_id] ||= []).push({
      scope_type: s.scope_type,
      scope_id: s.scope_id,
      label: labelFor(s),
    });
  }

  const enriched = members.map((m) => ({
    id: m.id,
    email: m.email,
    phone: m.phone,
    full_name: m.full_name,
    role: m.role,
    is_active: m.is_active,
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
    case "sdo":
      return "district";
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
// scope-options — org tree the manager can see
// ----------------------------------------------------------------------------

async function scopeOptions(supa, manager) {
  // user_visible_stores returns setof uuid (bare values).
  const { data: storeIds } = await supa.rpc("user_visible_stores", {
    uid: manager.id,
  });
  const ids = (storeIds ?? []).map((s) => (typeof s === "string" ? s : s));
  if (ids.length === 0) {
    return { stores: [], districts: [], markets: [], regions: [], canSetGlobal: manager.role === "admin" };
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
        .select("id, name, code, market_id")
        .in("id", districtIds)
        .order("name")
    : { data: [] };

  const marketIds = [...new Set((districts ?? []).map((d) => d.market_id))];
  const { data: markets } = marketIds.length
    ? await supa
        .from("markets")
        .select("id, name, code, region_id")
        .in("id", marketIds)
        .order("name")
    : { data: [] };

  const regionIds = [...new Set((markets ?? []).map((m) => m.region_id))];
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
    markets: markets ?? [],
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
  if (scopeType === "market") {
    const { data: districts } = await supa
      .from("districts")
      .select("id")
      .eq("market_id", scopeId);
    const districtIds = (districts ?? []).map((d) => d.id);
    if (!districtIds.length) return [];
    const { data: stores } = await supa
      .from("stores")
      .select("id")
      .in("district_id", districtIds);
    return (stores ?? []).map((s) => s.id);
  }
  if (scopeType === "region") {
    const { data: markets } = await supa
      .from("markets")
      .select("id")
      .eq("region_id", scopeId);
    const marketIds = (markets ?? []).map((m) => m.id);
    if (!marketIds.length) return [];
    const { data: districts } = await supa
      .from("districts")
      .select("id")
      .in("market_id", marketIds);
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
  const { data: inviteData, error: inviteErr } =
    await supa.auth.admin.inviteUserByEmail(email, {
      data: full_name ? { full_name } : undefined,
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

  return { ok: true, user_id: newUserId, email };
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
      return respond(400, { error: `unknown GET action: ${action}` });
    }

    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "add-user") return unwrap(await addUser(supa, manager, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }

    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
