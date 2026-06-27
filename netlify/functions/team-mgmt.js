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

// supabase.auth.admin.listUsers is page-based. We bound the loop to
// MAX_AUTH_PAGES * AUTH_USERS_PER_PAGE total users; past that the loop
// exits and we log a warning so we know to raise the cap before the
// silent-truncation symptoms (members showing as never-confirmed,
// bulk import re-inviting existing users) start hitting in production.
const AUTH_USERS_PER_PAGE = 200;
const MAX_AUTH_PAGES = 50; // -> 10000 users before truncation

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("team-mgmt env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// After any roster-affecting team mutation, re-sync managed group chats so
// auto-membership tracks hires / deactivations / transfers / role changes.
// Best-effort — never blocks the mutation response.
async function syncManagedGroups(supa, actorId) {
  try {
    await supa.rpc("chat_sync_managed_groups", { p_actor: actorId ?? null });
  } catch (e) {
    console.warn("[team-mgmt] managed-group sync failed:", e?.message || e);
  }
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
  // Additional ("acting") coverage rows — labeled and returned alongside the
  // primary scopes so the UI can show + manage extra coverage.
  const { data: addlScopes } = await supa
    .from("additional_scopes")
    .select("id, user_id, scope_type, scope_id, expires_at, note")
    .in("user_id", ids);

  // id → label maps are built from BOTH primary and additional scopes.
  const allScopeRows = [...(scopes ?? []), ...(addlScopes ?? [])];
  const storeIds = allScopeRows.filter((s) => s.scope_type === "store").map((s) => s.scope_id);
  const districtIds = allScopeRows.filter((s) => s.scope_type === "district").map((s) => s.scope_id);
  const areaIds = allScopeRows.filter((s) => s.scope_type === "area").map((s) => s.scope_id);
  const regionIds = allScopeRows.filter((s) => s.scope_type === "region").map((s) => s.scope_id);

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

  // Additional coverage, labeled, grouped by user.
  const additionalByUser = {};
  for (const a of addlScopes ?? []) {
    (additionalByUser[a.user_id] ||= []).push({
      id: a.id,
      scope_type: a.scope_type,
      scope_id: a.scope_id,
      label: labelFor(a),
      expires_at: a.expires_at,
      note: a.note,
    });
  }

  // Pull email_confirmed_at for each member from auth.admin.listUsers so the
  // UI can flag accounts that haven't activated yet (invite sent but link
  // never clicked / password never set). Cap at MAX_AUTH_PAGES * 200
  // users; warn loudly when the loop exits at the cap so we can raise
  // it before users past the cap silently show as "never confirmed".
  const memberIdSet = new Set(members.map((m) => m.id));
  const confirmedMap = {};
  try {
    let page = 1;
    let truncated = false;
    while (true) {
      const { data: usersPage, error: usersErr } = await supa.auth.admin.listUsers({
        page,
        perPage: AUTH_USERS_PER_PAGE,
      });
      if (usersErr) break;
      const users = usersPage?.users ?? [];
      for (const u of users) {
        if (memberIdSet.has(u.id)) {
          confirmedMap[u.id] = u.email_confirmed_at ?? null;
        }
      }
      if (users.length < AUTH_USERS_PER_PAGE) break;
      if (page >= MAX_AUTH_PAGES) {
        truncated = true;
        break;
      }
      page += 1;
    }
    if (truncated) {
      console.warn(
        `[team-mgmt] auth.admin.listUsers truncated at ${MAX_AUTH_PAGES} pages ` +
          `(~${MAX_AUTH_PAGES * AUTH_USERS_PER_PAGE} users); members past the cap may ` +
          `incorrectly show as never-confirmed. Raise MAX_AUTH_PAGES.`
      );
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
    additional_scopes: additionalByUser[m.id] ?? [],
  }));

  // Pull the rest of the per-profile fields the My Team UI surfaces:
  // preferred name, avatar, birthday + show_birthday, shirt size, CFM
  // cert info, leadership-managed start dates, and primary store id so
  // the GM-assigned-date can be hung off the right store on the UI.
  const { data: extras } = await supa
    .from("profiles")
    .select(
      "id, preferred_name, profile_photo_url, birthday, show_birthday, " +
        "shirt_size, favorite_quote, cfm_cert_number, cfm_issued_at, " +
        "cfm_expires_at, start_date, gm_assigned_date, primary_store_id"
    )
    .in("id", members.map((m) => m.id));
  const extrasById = Object.fromEntries((extras ?? []).map((e) => [e.id, e]));

  // Resolve primary store number/name once so the UI doesn't need a
  // second query to label the GM's home store.
  const primaryStoreIds = Array.from(
    new Set(
      (extras ?? [])
        .map((e) => e.primary_store_id)
        .filter(Boolean)
    )
  );
  let primaryStoreById = {};
  if (primaryStoreIds.length) {
    const { data: ps } = await supa
      .from("stores")
      .select("id, number, name")
      .in("id", primaryStoreIds);
    primaryStoreById = Object.fromEntries((ps ?? []).map((s) => [s.id, s]));
  }

  for (const row of enriched) {
    const e = extrasById[row.id] ?? {};
    row.preferred_name = e.preferred_name ?? null;
    row.profile_photo_url = e.profile_photo_url ?? null;
    row.birthday = e.birthday ?? null;
    row.show_birthday = e.show_birthday !== false;
    row.shirt_size = e.shirt_size ?? null;
    row.favorite_quote = e.favorite_quote ?? null;
    row.cfm_cert_number = e.cfm_cert_number ?? null;
    row.cfm_issued_at = e.cfm_issued_at ?? null;
    row.cfm_expires_at = e.cfm_expires_at ?? null;
    row.start_date = e.start_date ?? null;
    row.gm_assigned_date = e.gm_assigned_date ?? null;
    row.primary_store_id = e.primary_store_id ?? null;
    const ps = e.primary_store_id ? primaryStoreById[e.primary_store_id] : null;
    row.primary_store_number = ps?.number ?? null;
    row.primary_store_name = ps?.name ?? null;
  }

  // Per-member training summary — outstanding count (role-required +
  // assignment-driven, deduped) plus last-30d popup interactions. Fire each
  // RPC call in parallel and tolerate failures so one bad row doesn't blank
  // the column for the whole team. Empty defaults match the migration's
  // shape, so a missing summary just shows zeros.
  const summaries = await Promise.all(
    enriched.map(async (row) => {
      try {
        const { data } = await supa.rpc("qsr_user_training_summary", { uid: row.id });
        return Array.isArray(data) ? data[0] : data;
      } catch {
        return null;
      }
    }),
  );
  enriched.forEach((row, i) => {
    const s = summaries[i] || {};
    row.training_summary = {
      outstanding_count: Number(s.outstanding_count) || 0,
      shown_30d: Number(s.shown_30d) || 0,
      started_30d: Number(s.started_30d) || 0,
      dismissed_30d: Number(s.dismissed_30d) || 0,
    };
  });

  return { user: manager, members: enriched };
}

// ----------------------------------------------------------------------------
// Permission rules — encoded once, used by add/change/remove
// ----------------------------------------------------------------------------

// The hourly store-floor roles, all at the Shift Manager permission tier.
// Kept in assignable-role lists wherever shift_manager appears so the new
// titles show up in the Add/Edit member role pickers.
const HOURLY_STORE_ROLES = [
  "shift_manager",
  "first_assistant_manager",
  "associate_manager",
  "crew_leader",
  "crew_member",
  "carhop",
];

// Single-store roles: the hourly store roles plus GM. A store-level scope
// for one of these IS the user's primary store.
function isSingleStoreRole(role) {
  return role === "gm" || HOURLY_STORE_ROLES.includes(role);
}

// Who can correct a team member's email address? DO and above only — it
// rewrites the sign-in credential, so it's held above the GM tier.
const EMAIL_EDIT_ROLES = ["do", "sdo", "rvp", "vp", "coo", "admin"];

// Additional ("acting") scope assigners. Org-wide roles assign to anyone with
// any in-reach scope (they see everything). RVP/SDO may also assign, but only
// to a user on their team and only coverage fully within their own reach.
const ORG_WIDE_SCOPE_ROLES = ["admin", "coo", "vp"];
const SCOPE_ASSIGNER_ROLES = ["admin", "coo", "vp", "rvp", "sdo"];

// Which roles can a manager create / change-to?
function manageableRoles(role) {
  switch (role) {
    case "admin":
      return [...HOURLY_STORE_ROLES, "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll", "accounting", "facilities", "human_resources"];
    case "coo":
    case "vp":
      return [...HOURLY_STORE_ROLES, "gm", "do", "sdo", "rvp"];
    case "rvp":
      return [...HOURLY_STORE_ROLES, "gm", "do", "sdo"];
    case "sdo":
    case "do":
      return [...HOURLY_STORE_ROLES, "gm"];
    case "gm":
      return [...HOURLY_STORE_ROLES];
    default:
      return [];
  }
}

// What scope_type does each new-user role get?
function scopeForRole(role) {
  switch (role) {
    case "shift_manager":
    case "first_assistant_manager":
    case "associate_manager":
    case "crew_leader":
    case "crew_member":
    case "carhop":
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
    case "accounting":
    case "facilities":
    case "human_resources":
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
    // supabase-js returns PostgREST errors in the result object — it
    // does NOT throw — so we have to destructure { error }. A bare
    // try/catch around the insert silently drops failed audit rows.
    const { error } = await supa.from("team_changes").insert({
      actor_id,
      target_id,
      action,
      before: before ?? null,
      after: after ?? null,
    });
    if (error) console.warn("[team-mgmt] audit log insert failed", error);
  } catch (e) {
    console.warn("[team-mgmt] audit log insert threw", e);
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
  // primary_store_id is kept in sync with the scope (see updateUser for
  // the same logic) — gm / shift_manager + store scope → that store;
  // anything else → null. Keeps user_visible_stores from double-counting.
  const newPrimary =
    isSingleStoreRole(role) && expectedScope === "store"
      ? scope_id
      : null;
  const { error: profileErr } = await supa
    .from("profiles")
    .update({
      full_name,
      phone: normalizedPhone,
      role,
      is_active: true,
      primary_store_id: newPrimary,
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

  // Email correction — DO+ only. Used to fix a mistyped invite address.
  // Rewrites both the auth.users credential and profiles.email, then (if the
  // account hasn't been activated yet) re-issues an invite/recovery link to
  // the corrected inbox so the original wrong-email link isn't the only way in.
  let reissuedTo = null;
  if (
    body.email !== undefined &&
    body.email !== null &&
    String(body.email).trim() !== ""
  ) {
    if (!EMAIL_EDIT_ROLES.includes(manager.role)) {
      return {
        error: "Only a DO or above can change a team member's email.",
        status: 403,
      };
    }
    const newEmail = String(body.email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
      return { error: "Enter a valid email address.", status: 400 };
    }
    const currentEmail = (target.email ?? "").toLowerCase();
    if (newEmail !== currentEmail) {
      // Don't collide with another account's email.
      const { data: clash } = await supa
        .from("profiles")
        .select("id")
        .ilike("email", newEmail)
        .neq("id", target_id)
        .maybeSingle();
      if (clash) {
        return { error: "Another user already has that email.", status: 409 };
      }

      // Update the credential first — this is what surfaces a dup the
      // profiles check above might miss.
      const { error: authErr } = await supa.auth.admin.updateUserById(
        target_id,
        { email: newEmail }
      );
      if (authErr) {
        const dup = /already|registered|exists|duplicate/i.test(
          authErr.message || ""
        );
        return {
          error: dup
            ? "Another user already has that email."
            : `Couldn't update email: ${authErr.message}`,
          status: dup ? 409 : 500,
        };
      }
      updates.email = newEmail;

      // If they haven't activated yet, send a fresh link to the new inbox.
      // Mirrors send-reset: a recovery link lets an un-activated user set
      // their password and confirms the corrected address in one step.
      let confirmed = false;
      try {
        const { data: au } = await supa.auth.admin.getUserById(target_id);
        confirmed = !!au?.user?.email_confirmed_at;
      } catch {
        /* treat as un-activated — re-issuing is the safer default */
      }
      if (!confirmed) {
        const redirectTo =
          (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "") +
          "/reset-password";
        const { error: linkErr } = await supa.auth.resetPasswordForEmail(
          newEmail,
          { redirectTo: redirectTo || undefined }
        );
        if (linkErr) {
          console.warn("[team-mgmt] email change: re-invite failed", linkErr);
        } else {
          reissuedTo = newEmail;
        }
      }
    }
  }

  // Start date / GM-assigned date — leadership-managed HR fields. Empty
  // string clears to null; otherwise must look like YYYY-MM-DD so a
  // bad client can't poison the column with garbage that breaks date
  // arithmetic on read.
  for (const f of ["start_date", "gm_assigned_date"]) {
    if (body[f] !== undefined) {
      const raw = body[f];
      if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
        updates[f] = null;
      } else if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
        updates[f] = raw.trim();
      } else {
        return { error: `${f} must be YYYY-MM-DD or empty.`, status: 400 };
      }
    }
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

    // Keep profiles.primary_store_id in sync with the scope. For
    // gm / shift_manager a store-level scope IS the primary store,
    // so they must match — otherwise user_visible_stores() returns
    // the union of both, and the user keeps seeing their old store
    // after a "transfer". For broader scopes (district / area /
    // region / global) or non-gm/sm roles, primary_store_id has no
    // defined meaning and must be cleared.
    const primaryFix =
      isSingleStoreRole(effectiveRole) &&
      newScope.scope_type === "store"
        ? { primary_store_id: newScope.scope_id }
        : { primary_store_id: null };
    const { error: primErr } = await supa
      .from("profiles")
      .update(primaryFix)
      .eq("id", target_id);
    if (primErr) {
      return {
        error: `Couldn't sync primary_store_id: ${primErr.message}`,
        status: 500,
      };
    }
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
  if ("email" in updates) {
    before.email = target.email ?? null;
    after.email = updates.email;
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

  return { ok: true, email_reissued: reissuedTo };
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
// delete-user — admin-only PERMANENT delete
// ----------------------------------------------------------------------------
//
// Hard-deletes the auth user, which cascades to profiles → user_scopes.
// The deletion is logged to team_changes FIRST (while target_id is still a
// valid FK); the row survives the cascade because migration 0107 made
// target_id ON DELETE SET NULL. We snapshot email / name / role / scopes
// into before{} so the org-wide history feed stays meaningful once the
// profile is gone.
//
// Users referenced by ON DELETE RESTRICT FKs elsewhere (e.g. they submitted
// a PAF) can't be hard-deleted — Supabase returns a FK error and we surface
// it; those should be deactivated instead.

async function deleteUser(supa, manager, body) {
  if (manager.role !== "admin") {
    return { error: "Only Admins can permanently delete users.", status: 403 };
  }
  const target_id = body?.user_id;
  if (!target_id) return { error: "user_id is required.", status: 400 };
  if (target_id === manager.id) {
    return { error: "You can't delete your own account.", status: 403 };
  }

  const { data: target } = await supa
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", target_id)
    .maybeSingle();
  if (!target) return { error: "User not found.", status: 404 };

  const { data: scopes } = await supa
    .from("user_scopes")
    .select("scope_type, scope_id")
    .eq("user_id", target_id);

  // Log first, while the target FK is still valid. SET NULL preserves the
  // row; before{} keeps it identifiable after the profile is gone.
  await logChange(supa, {
    actor_id: manager.id,
    target_id,
    action: "delete",
    before: {
      email: target.email,
      full_name: target.full_name ?? null,
      role: target.role,
      scopes: scopes ?? [],
    },
    after: null,
  });

  const { error: delErr } = await supa.auth.admin.deleteUser(target_id);
  if (delErr) {
    const msg = /foreign key|violates|constraint/i.test(delErr.message || "")
      ? "This user has historical records (e.g. submitted forms) and can't be permanently deleted. Deactivate them instead."
      : `Delete failed: ${delErr.message}`;
    return { error: msg, status: 409 };
  }

  return { ok: true };
}

// ----------------------------------------------------------------------------
// add-scope / remove-scope — additional ("acting") coverage on top of a
// user's primary role scope. Top-of-house only. Writes to additional_scopes,
// which user_visible_stores() unions in (non-expired), so the grant flows to
// My Team, RLS, labor, etc. automatically.
// ----------------------------------------------------------------------------

async function addScope(supa, manager, body) {
  if (!SCOPE_ASSIGNER_ROLES.includes(manager.role)) {
    return { error: "You don't have permission to assign additional scope.", status: 403 };
  }
  const target_id = body?.user_id;
  const scope_type = body?.scope_type;
  const scope_id = body?.scope_id ?? null;
  const note = body?.note ? String(body.note).trim().slice(0, 200) || null : null;

  if (!target_id) return { error: "user_id is required.", status: 400 };
  if (!["store", "district", "area", "region"].includes(scope_type)) {
    return { error: "scope_type must be store, district, area, or region.", status: 400 };
  }
  if (!scope_id) return { error: "A scope must be selected.", status: 400 };

  // Optional end date for temporary acting coverage. Stored as end-of-day UTC
  // so the assignment stays live through the chosen day.
  let expires_at = null;
  if (body?.expires_at) {
    const raw = String(body.expires_at).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return { error: "End date must be YYYY-MM-DD or empty.", status: 400 };
    }
    expires_at = `${raw}T23:59:59Z`;
  }

  const { data: target } = await supa
    .from("profiles")
    .select("id, is_active")
    .eq("id", target_id)
    .maybeSingle();
  if (!target) return { error: "User not found.", status: 404 };
  if (!target.is_active) return { error: "That user is inactive.", status: 400 };

  // The scope must resolve to at least one active store (catches a stale id).
  const targetStores = await resolveStoresForScope(supa, scope_type, scope_id);
  if (!targetStores.length) {
    return { error: "That scope has no active stores.", status: 400 };
  }

  // RVP/SDO assigners are constrained to their own team + reach; org-wide
  // roles (admin/vp/coo) see everything and skip both checks.
  if (!ORG_WIDE_SCOPE_ROLES.includes(manager.role)) {
    const { data: managed } = await supa.rpc("manageable_users", { manager_id: manager.id });
    if (!(managed ?? []).some((m) => m.id === target_id)) {
      return { error: "That user isn't on your team.", status: 403 };
    }
    const { data: managerStoreIds } = await supa.rpc("user_visible_stores", { uid: manager.id });
    const reach = new Set(managerStoreIds ?? []);
    if (targetStores.some((id) => !reach.has(id))) {
      return { error: "That coverage is outside your reach.", status: 403 };
    }
  }

  const { error: insErr } = await supa.from("additional_scopes").insert({
    user_id: target_id,
    scope_type,
    scope_id,
    note,
    expires_at,
    created_by: manager.id,
  });
  if (insErr) {
    if (/duplicate|unique/i.test(insErr.message || "")) {
      return { error: "That scope is already assigned to this user.", status: 409 };
    }
    return { error: `Couldn't assign scope: ${insErr.message}`, status: 500 };
  }

  await logChange(supa, {
    actor_id: manager.id,
    target_id,
    action: "add_scope",
    before: null,
    after: { scope_type, scope_id, expires_at, note },
  });

  return { ok: true };
}

async function removeScope(supa, manager, body) {
  if (!SCOPE_ASSIGNER_ROLES.includes(manager.role)) {
    return { error: "You don't have permission to remove additional scope.", status: 403 };
  }
  const id = body?.id;
  if (!id) return { error: "id is required.", status: 400 };

  const { data: row } = await supa
    .from("additional_scopes")
    .select("id, user_id, scope_type, scope_id, expires_at, note")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Scope assignment not found.", status: 404 };

  // RVP/SDO can only remove coverage from a teammate, and only coverage that
  // sits within their own reach; org-wide roles skip both checks.
  if (!ORG_WIDE_SCOPE_ROLES.includes(manager.role)) {
    const { data: managed } = await supa.rpc("manageable_users", { manager_id: manager.id });
    if (!(managed ?? []).some((m) => m.id === row.user_id)) {
      return { error: "That user isn't on your team.", status: 403 };
    }
    const rowStores = await resolveStoresForScope(supa, row.scope_type, row.scope_id);
    const { data: managerStoreIds } = await supa.rpc("user_visible_stores", { uid: manager.id });
    const reach = new Set(managerStoreIds ?? []);
    if (rowStores.length && rowStores.some((sid) => !reach.has(sid))) {
      return { error: "That coverage is outside your reach.", status: 403 };
    }
  }

  const { error: delErr } = await supa.from("additional_scopes").delete().eq("id", id);
  if (delErr) return { error: `Couldn't remove scope: ${delErr.message}`, status: 500 };

  await logChange(supa, {
    actor_id: manager.id,
    target_id: row.user_id,
    action: "remove_scope",
    before: { scope_type: row.scope_type, scope_id: row.scope_id, expires_at: row.expires_at, note: row.note },
    after: null,
  });

  return { ok: true };
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

const ALL_ROLES = [...HOURLY_STORE_ROLES,"gm","do","sdo","rvp","vp","coo","admin","payroll","accounting","facilities","human_resources"];

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

  // Pre-load existing emails so we can mark duplicates upfront. Cap
  // at MAX_AUTH_PAGES * AUTH_USERS_PER_PAGE; warn if truncated so a
  // bulk import doesn't silently re-invite users that already exist.
  const existingEmails = new Set();
  try {
    let page = 1;
    let truncated = false;
    while (true) {
      const { data, error } = await supa.auth.admin.listUsers({
        page,
        perPage: AUTH_USERS_PER_PAGE,
      });
      if (error) break;
      for (const u of data?.users ?? []) {
        if (u.email) existingEmails.add(u.email.toLowerCase());
      }
      if ((data?.users ?? []).length < AUTH_USERS_PER_PAGE) break;
      if (page >= MAX_AUTH_PAGES) {
        truncated = true;
        break;
      }
      page += 1;
    }
    if (truncated) {
      console.warn(
        `[team-mgmt] bulkValidate: listUsers truncated at ${MAX_AUTH_PAGES} pages ` +
          `(~${MAX_AUTH_PAGES * AUTH_USERS_PER_PAGE} users); duplicate detection may miss ` +
          `users past the cap and re-invite them. Raise MAX_AUTH_PAGES.`
      );
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

      // Keep primary_store_id in sync with the scope, same as addUser —
      // gm / shift_manager at store scope → that store; otherwise null.
      // Without this, bulk-imported GMs/SMs get a scope but a null primary
      // store, which breaks the GM home-store features.
      const bulkPrimary =
        isSingleStoreRole(r.role) && r.scope_type === "store"
          ? r.scope_id
          : null;
      const { error: profileErr } = await supa
        .from("profiles")
        .update({
          full_name: r.full_name,
          phone: r.phone,
          role: r.role,
          is_active: true,
          primary_store_id: bulkPrimary,
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
// CFM expiring — current user's own status + their team's expiring certs
// ----------------------------------------------------------------------------
//
// Anyone signed in can call this. The "self" object always reflects the
// caller; the "team" object is only populated for managers (gm and above).
// Day windows: anything with cfm_expires_at <= today + N days counts as
// "expiring within N", anything <= today counts as "expired".

async function cfmExpiring(supa, manager, query) {
  const days = Math.max(0, parseInt(query?.days ?? "60", 10) || 60);

  // 1. Self status — pull the caller's CFM fields directly.
  const { data: selfRow } = await supa
    .from("profiles")
    .select("cfm_cert_number, cfm_issued_at, cfm_expires_at")
    .eq("id", manager.id)
    .maybeSingle();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function classify(expiresAt, windowDays) {
    if (!expiresAt) return null;
    const exp = new Date(expiresAt);
    const ms = exp.getTime() - today.getTime();
    const daysLeft = Math.floor(ms / 86400000);
    let status = "valid";
    if (daysLeft < 0) status = "expired";
    else if (daysLeft <= windowDays) status = "expiring";
    return { days_left: daysLeft, status };
  }

  const self = {
    has_cert: !!(selfRow?.cfm_cert_number || selfRow?.cfm_issued_at),
    cert_number: selfRow?.cfm_cert_number ?? null,
    issued_at: selfRow?.cfm_issued_at ?? null,
    expires_at: selfRow?.cfm_expires_at ?? null,
    ...(classify(selfRow?.cfm_expires_at, days) ?? { days_left: null, status: "none" }),
  };

  // 2. Team — gated to managers only. shift_manager / payroll get no list.
  let team = { count_expiring: 0, count_expired: 0, list: [] };
  const canManage = !HOURLY_STORE_ROLES.includes(manager.role) && manager.role !== "payroll";
  if (canManage) {
    const { data: managed, error: rpcErr } = await supa.rpc("manageable_users", {
      manager_id: manager.id,
    });
    if (rpcErr) {
      return { error: `manageable_users failed: ${rpcErr.message}`, status: 500 };
    }
    // Filter to people whose cert is expired or within the window.
    const flagged = (managed ?? [])
      .map((p) => {
        const c = classify(p.cfm_expires_at, days);
        return c ? { ...p, ...c } : null;
      })
      .filter((p) => p && (p.status === "expired" || p.status === "expiring"));

    team = {
      count_expiring: flagged.filter((p) => p.status === "expiring").length,
      count_expired: flagged.filter((p) => p.status === "expired").length,
      list: flagged
        .sort((a, b) => a.days_left - b.days_left)
        .map((p) => ({
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          phone: p.phone,
          role: p.role,
          cfm_cert_number: p.cfm_cert_number,
          cfm_issued_at: p.cfm_issued_at,
          cfm_expires_at: p.cfm_expires_at,
          days_left: p.days_left,
          status: p.status,
        })),
    };
  }

  return { self, team, window_days: days };
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
      if (action === "cfm-expiring") {
        return unwrap(await cfmExpiring(supa, manager, params));
      }
      return respond(400, { error: `unknown GET action: ${action}` });
    }

    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      // Roster-affecting mutations: re-sync managed group chats on success.
      if (
        action === "add-user" ||
        action === "update-user" ||
        action === "bulk-import" ||
        action === "delete-user" ||
        action === "add-scope" ||
        action === "remove-scope"
      ) {
        const fn =
          action === "add-user"
            ? addUser
            : action === "update-user"
              ? updateUser
              : action === "bulk-import"
                ? bulkImport
                : action === "delete-user"
                  ? deleteUser
                  : action === "add-scope"
                    ? addScope
                    : removeScope;
        const result = await fn(supa, manager, body);
        if (!result?.error) await syncManagedGroups(supa, manager.id);
        return unwrap(result);
      }
      if (action === "send-reset") return unwrap(await sendReset(supa, manager, body));
      if (action === "bulk-preview") return unwrap(await bulkPreview(supa, manager, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }

    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
