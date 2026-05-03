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
      return respond(400, { error: `unknown GET action: ${action}` });
    }

    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
