// netlify/functions/org-mgmt.js
//
// Phase 2c — Org Admin tree backend.
//
// Auth bridge: same pattern as team-mgmt.js. Validates the Supabase JWT,
// confirms the caller is admin / coo / vp (org-wide tiers), then returns
// the full org tree in one shot.
//
// Actions (V1 — read-only):
//
//   GET /.netlify/functions/org-mgmt?action=tree
//     -> {
//          regions: [{
//            id, code, name, is_active,
//            managers: [{ id, full_name, email, role }],
//            areas: [{
//              id, code, name, is_active,
//              managers: [...],
//              districts: [{
//                id, code, name, is_active,
//                managers: [...],
//                stores: [{
//                  id, number, name, phone, address, city, state, zip,
//                  is_active, managers: [...]
//                }]
//              }]
//            }]
//          }],
//          stats: {
//            total_regions, total_areas, total_districts,
//            total_stores, active_stores, vacant_scopes
//          }
//        }
//
// V2 will add write actions (rename, move, deactivate, add) and audit
// inserts into org_changes. V1 leaves writes alone on purpose.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("org-mgmt env vars not configured");
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

// Who can see the org admin tree?
// Admin/coo/vp = org-wide, view everything.
// Others get 403 — they have My Team for their slice.
const ORG_ADMIN_ROLES = new Set(["admin", "coo", "vp"]);

// ----------------------------------------------------------------------------
// tree — full org hierarchy in one nested response
// ----------------------------------------------------------------------------

async function buildTree(supa) {
  // Pull everything in parallel; assemble client-side.
  const [
    { data: regions },
    { data: areas },
    { data: districts },
    { data: stores },
    { data: scopes },
  ] = await Promise.all([
    supa.from("regions").select("id, code, name, is_active").order("code"),
    supa.from("areas").select("id, code, name, region_id, is_active").order("code"),
    supa
      .from("districts")
      .select("id, code, name, area_id, is_active")
      .order("code"),
    supa
      .from("stores")
      .select(
        "id, number, name, phone, address, city, state, zip, district_id, is_active"
      )
      .order("number"),
    supa
      .from("user_scopes")
      .select("user_id, scope_type, scope_id"),
  ]);

  // Resolve managers for each scope row.
  const userIds = [...new Set((scopes ?? []).map((s) => s.user_id))];
  const { data: profiles } = userIds.length
    ? await supa
        .from("profiles")
        .select("id, full_name, email, role, is_active")
        .in("id", userIds)
        .eq("is_active", true)
    : { data: [] };
  const profileMap = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p])
  );

  // Group active managers by scope_type + scope_id ("region:UUID", etc.)
  const managersByScope = new Map();
  for (const s of scopes ?? []) {
    const profile = profileMap[s.user_id];
    if (!profile) continue; // inactive or filtered
    const key = `${s.scope_type}:${s.scope_id ?? "global"}`;
    if (!managersByScope.has(key)) managersByScope.set(key, []);
    managersByScope.get(key).push({
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      role: profile.role,
    });
  }
  const lookup = (kind, id) => managersByScope.get(`${kind}:${id}`) ?? [];

  // Index for nesting
  const storesByDistrict = new Map();
  for (const s of stores ?? []) {
    if (!storesByDistrict.has(s.district_id)) storesByDistrict.set(s.district_id, []);
    storesByDistrict.get(s.district_id).push({
      id: s.id,
      number: s.number,
      name: s.name,
      phone: s.phone,
      address: s.address,
      city: s.city,
      state: s.state,
      zip: s.zip,
      is_active: s.is_active,
      managers: lookup("store", s.id),
    });
  }

  const districtsByArea = new Map();
  for (const d of districts ?? []) {
    if (!districtsByArea.has(d.area_id)) districtsByArea.set(d.area_id, []);
    districtsByArea.get(d.area_id).push({
      id: d.id,
      code: d.code,
      name: d.name,
      is_active: d.is_active,
      managers: lookup("district", d.id),
      stores: storesByDistrict.get(d.id) ?? [],
    });
  }

  const areasByRegion = new Map();
  for (const a of areas ?? []) {
    if (!areasByRegion.has(a.region_id)) areasByRegion.set(a.region_id, []);
    areasByRegion.get(a.region_id).push({
      id: a.id,
      code: a.code,
      name: a.name,
      is_active: a.is_active,
      managers: lookup("area", a.id),
      districts: districtsByArea.get(a.id) ?? [],
    });
  }

  const tree = (regions ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    is_active: r.is_active,
    managers: lookup("region", r.id),
    areas: areasByRegion.get(r.id) ?? [],
  }));

  // Stats — count vacancies as nodes (region/area/district/store) with no
  // direct manager. Doesn't count "covered by ancestor" — that's a UI hint.
  let vacant = 0;
  for (const r of tree) {
    if (r.managers.length === 0) vacant++;
    for (const a of r.areas) {
      if (a.managers.length === 0) vacant++;
      for (const d of a.districts) {
        if (d.managers.length === 0) vacant++;
        for (const s of d.stores) {
          if (s.managers.length === 0) vacant++;
        }
      }
    }
  }

  return {
    regions: tree,
    stats: {
      total_regions: (regions ?? []).length,
      total_areas: (areas ?? []).length,
      total_districts: (districts ?? []).length,
      total_stores: (stores ?? []).length,
      active_stores: (stores ?? []).filter((s) => s.is_active).length,
      vacant_scopes: vacant,
    },
  };
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let user;
  try {
    user = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!user) return respond(401, { error: "unauthorized" });
  if (!ORG_ADMIN_ROLES.has(user.role)) {
    return respond(403, { error: "Org Admin is restricted to admin / VP / COO." });
  }

  const params = event.queryStringParameters || {};
  const action = params.action || "tree";

  try {
    const supa = admin();
    if (event.httpMethod === "GET" && action === "tree") {
      return respond(200, await buildTree(supa));
    }
    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
