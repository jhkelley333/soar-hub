// netlify/functions/org.js
//
// Read-only org views for the My Stores tab + Birthday dashboard
// widget. Distinct from org-mgmt.js (which is admin write-side) — this
// one is scoped per caller and shaped for read consumption.
//
// Actions:
//
//   GET ?action=my-tree
//     -> { regions[], leadership[] } scoped to the caller's reach.
//        Each region contains areas → districts → stores → team_members.
//        leadership map gives each store its DO/SDO/RVP for the
//        Leadership card on the store detail page.
//
//   GET ?action=birthdays&start=YYYY-MM-DD&end=YYYY-MM-DD
//     -> { entries[] } — every active profile in caller's scope with a
//        birthday whose month-day falls in the inclusive window. Honors
//        profiles.show_birthday (false → hidden); GM-only opt-out.
//        Each entry includes a region_id so the dashboard can group by
//        RVP without an extra round-trip.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ORG_WIDE = new Set(["payroll", "admin", "vp", "coo"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("org env vars not configured");
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
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, primary_store_id, is_active")
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

// Returns the array of store ids the caller can see. Org-wide roles get
// every active store; everyone else flows through user_visible_stores().
async function callerVisibleStoreIds(supa, user) {
  if (ORG_WIDE.has(user.role)) {
    const { data } = await supa.from("stores").select("id").eq("is_active", true);
    return (data ?? []).map((s) => s.id);
  }
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  return (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
}

// Pull every active profile that has a primary_store in the visible set,
// plus every DO/SDO/RVP whose scope covers any of those stores. Returns
// a deduped array of full profile rows.
async function callerVisibleProfiles(supa, user, visibleStoreIds) {
  if (!visibleStoreIds.length && !ORG_WIDE.has(user.role)) return [];

  const baseSelect =
    "id, email, phone, full_name, preferred_name, role, primary_store_id, is_active, birthday, show_birthday, profile_photo_url";

  if (ORG_WIDE.has(user.role)) {
    const { data } = await supa
      .from("profiles")
      .select(baseSelect)
      .eq("is_active", true);
    return data ?? [];
  }

  // 1) Store-level employees with primary_store_id in scope.
  const { data: storeFolks } = await supa
    .from("profiles")
    .select(baseSelect)
    .in("primary_store_id", visibleStoreIds)
    .eq("is_active", true);

  // 2) Anyone with a user_scopes row mapping into our visible org slice.
  // First resolve the caller's reach in district/area/region terms via
  // the visible store ids — anyone scoped to those nodes is in reach.
  const { data: storeRows } = await supa
    .from("stores")
    .select("id, district_id")
    .in("id", visibleStoreIds);
  const districtIds = Array.from(
    new Set((storeRows ?? []).map((s) => s.district_id).filter(Boolean))
  );
  const { data: districtRows } = districtIds.length
    ? await supa.from("districts").select("id, area_id").in("id", districtIds)
    : { data: [] };
  const areaIds = Array.from(
    new Set((districtRows ?? []).map((d) => d.area_id).filter(Boolean))
  );
  const { data: areaRows } = areaIds.length
    ? await supa.from("areas").select("id, region_id").in("id", areaIds)
    : { data: [] };
  const regionIds = Array.from(
    new Set((areaRows ?? []).map((a) => a.region_id).filter(Boolean))
  );

  const scopedUserIds = new Set();
  for (const [scopeType, ids] of [
    ["store", visibleStoreIds],
    ["district", districtIds],
    ["area", areaIds],
    ["region", regionIds],
  ]) {
    if (!ids.length) continue;
    const { data: scopes } = await supa
      .from("user_scopes")
      .select("user_id")
      .eq("scope_type", scopeType)
      .in("scope_id", ids);
    for (const s of scopes ?? []) scopedUserIds.add(s.user_id);
  }

  let scopedProfiles = [];
  if (scopedUserIds.size) {
    const { data } = await supa
      .from("profiles")
      .select(baseSelect)
      .in("id", Array.from(scopedUserIds))
      .eq("is_active", true);
    scopedProfiles = data ?? [];
  }

  // Dedupe.
  const byId = new Map();
  for (const p of [...(storeFolks ?? []), ...scopedProfiles]) byId.set(p.id, p);
  return Array.from(byId.values());
}

// ----------------------------------------------------------------------------
// my-tree
// ----------------------------------------------------------------------------
async function getMyTree(supa, user) {
  const visibleStoreIds = await callerVisibleStoreIds(supa, user);
  if (!visibleStoreIds.length) {
    return { regions: [], leadership: {} };
  }

  const [{ data: storeRows }, { data: districtRows }, { data: areaRows }, { data: regionRows }] =
    await Promise.all([
      supa
        .from("stores")
        .select(
          "id, number, name, city, state, phone, address, district_id, is_active, " +
            "plate_iq_email, soar_company_name, food_vendor_name, " +
            "food_vendor_contact_name, food_vendor_contact_phone, " +
            "food_vendor_contact_email, food_vendor_account_number"
        )
        .in("id", visibleStoreIds)
        .order("number"),
      supa.from("districts").select("id, code, name, area_id, is_active"),
      supa.from("areas").select("id, code, name, region_id, is_active"),
      supa.from("regions").select("id, code, name, is_active"),
    ]);

  const stores = storeRows ?? [];
  const districtIdsInScope = Array.from(
    new Set(stores.map((s) => s.district_id).filter(Boolean))
  );
  const districts = (districtRows ?? []).filter((d) => districtIdsInScope.includes(d.id));
  const areaIdsInScope = Array.from(
    new Set(districts.map((d) => d.area_id).filter(Boolean))
  );
  const areas = (areaRows ?? []).filter((a) => areaIdsInScope.includes(a.id));
  const regionIdsInScope = Array.from(
    new Set(areas.map((a) => a.region_id).filter(Boolean))
  );
  const regions = (regionRows ?? []).filter((r) => regionIdsInScope.includes(r.id));

  // Team members per store: profiles with primary_store_id in scope.
  const { data: members } = await supa
    .from("profiles")
    .select(
      "id, email, phone, full_name, preferred_name, role, primary_store_id, is_active, birthday, show_birthday, profile_photo_url"
    )
    .in("primary_store_id", visibleStoreIds)
    .eq("is_active", true);

  const membersByStore = new Map();
  for (const m of members ?? []) {
    if (!m.primary_store_id) continue;
    const list = membersByStore.get(m.primary_store_id) ?? [];
    list.push(m);
    membersByStore.set(m.primary_store_id, list);
  }

  // Managers (DO / SDO / RVP) by district / area / region — stitched
  // onto each store as the Leadership card data.
  const { data: scopeRows } = await supa
    .from("user_scopes")
    .select("user_id, scope_type, scope_id")
    .in("scope_type", ["district", "area", "region"]);
  const scopedUserIds = Array.from(new Set((scopeRows ?? []).map((r) => r.user_id)));
  let scopedProfiles = [];
  if (scopedUserIds.length) {
    const { data } = await supa
      .from("profiles")
      .select(
        "id, email, phone, full_name, preferred_name, role, primary_store_id, is_active"
      )
      .in("id", scopedUserIds)
      .eq("is_active", true);
    scopedProfiles = data ?? [];
  }
  const profileById = new Map(scopedProfiles.map((p) => [p.id, p]));

  function findManager(role, scopeType, scopeId) {
    if (!scopeId) return null;
    const row = (scopeRows ?? []).find(
      (s) => s.scope_type === scopeType && s.scope_id === scopeId
        && profileById.get(s.user_id)?.role === role
    );
    return row ? profileById.get(row.user_id) : null;
  }

  // GM per store: pulled from the team-members fetch above, since GMs
  // are stored as profiles with role='gm' + primary_store_id pointing
  // at the store.
  const gmByStore = new Map();
  for (const m of members ?? []) {
    if (m.role === "gm" && m.primary_store_id) {
      gmByStore.set(m.primary_store_id, m);
    }
  }

  // Build the leadership map keyed by store id.
  const leadership = {};
  const districtById = new Map(districts.map((d) => [d.id, d]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  for (const s of stores) {
    const district = districtById.get(s.district_id);
    const area = district ? areaById.get(district.area_id) : null;
    const regionId = area?.region_id ?? null;
    leadership[s.id] = {
      gm: gmByStore.get(s.id) ?? null,
      do: findManager("do", "district", district?.id),
      sdo: findManager("sdo", "area", area?.id),
      rvp: findManager("rvp", "region", regionId),
    };
  }

  // Build nested tree structure: regions → areas → districts → stores.
  const tree = regions.map((r) => ({
    ...r,
    areas: areas
      .filter((a) => a.region_id === r.id)
      .map((a) => ({
        ...a,
        districts: districts
          .filter((d) => d.area_id === a.id)
          .map((d) => ({
            ...d,
            stores: stores
              .filter((s) => s.district_id === d.id)
              .map((s) => ({
                ...s,
                team_members: membersByStore.get(s.id) ?? [],
              })),
          })),
      })),
  }));

  return { regions: tree, leadership };
}

// ----------------------------------------------------------------------------
// birthdays
// ----------------------------------------------------------------------------

// Returns true if month-day of `iso` (YYYY-MM-DD birthday) falls inside
// the inclusive window [startISO..endISO]. Window can wrap year-end
// (e.g. Dec 28 .. Jan 10) — we compare on month-day not full date.
function birthdayInWindow(iso, startISO, endISO) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const md = iso.slice(5); // "MM-DD"
  const sm = startISO.slice(5);
  const em = endISO.slice(5);
  if (sm <= em) return md >= sm && md <= em;
  // Wrapped window — birthday counts if it's after start OR before end.
  return md >= sm || md <= em;
}

async function getBirthdays(supa, user, query) {
  const start = String(query?.start || "").trim();
  const end = String(query?.end || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: "start and end must be YYYY-MM-DD.", status: 400 };
  }

  const visibleStoreIds = await callerVisibleStoreIds(supa, user);
  const profiles = await callerVisibleProfiles(supa, user, visibleStoreIds);

  // Build store -> region lookup so each entry can carry region_id for
  // grouping by RVP on the client. One bulk query.
  const storeIds = Array.from(
    new Set(profiles.map((p) => p.primary_store_id).filter(Boolean))
  );
  const storeRegion = new Map();
  if (storeIds.length) {
    const { data: storeRows } = await supa
      .from("stores")
      .select("id, number, name, district_id")
      .in("id", storeIds);
    const districtIds = Array.from(
      new Set((storeRows ?? []).map((s) => s.district_id).filter(Boolean))
    );
    const { data: distRows } = districtIds.length
      ? await supa.from("districts").select("id, area_id").in("id", districtIds)
      : { data: [] };
    const areaIds = Array.from(
      new Set((distRows ?? []).map((d) => d.area_id).filter(Boolean))
    );
    const { data: areaRows } = areaIds.length
      ? await supa.from("areas").select("id, region_id").in("id", areaIds)
      : { data: [] };
    const distById = new Map((distRows ?? []).map((d) => [d.id, d]));
    const areaById = new Map((areaRows ?? []).map((a) => [a.id, a]));
    for (const s of storeRows ?? []) {
      const dist = s.district_id ? distById.get(s.district_id) : null;
      const area = dist?.area_id ? areaById.get(dist.area_id) : null;
      storeRegion.set(s.id, {
        store_number: s.number,
        store_name: s.name,
        region_id: area?.region_id ?? null,
      });
    }
  }

  // Build region -> RVP-name lookup.
  const allRegionIds = Array.from(
    new Set(Array.from(storeRegion.values()).map((v) => v.region_id).filter(Boolean))
  );
  const rvpByRegion = new Map();
  const regionById = new Map();
  if (allRegionIds.length) {
    const { data: regionRows } = await supa
      .from("regions")
      .select("id, code, name")
      .in("id", allRegionIds);
    for (const r of regionRows ?? []) regionById.set(r.id, r);
    const { data: rvpScopes } = await supa
      .from("user_scopes")
      .select("user_id, scope_id")
      .eq("scope_type", "region")
      .in("scope_id", allRegionIds);
    if (rvpScopes?.length) {
      const userIds = Array.from(new Set(rvpScopes.map((s) => s.user_id)));
      const { data: rvpProfiles } = await supa
        .from("profiles")
        .select("id, full_name, preferred_name, role")
        .in("id", userIds)
        .eq("role", "rvp")
        .eq("is_active", true);
      const rvpById = new Map((rvpProfiles ?? []).map((p) => [p.id, p]));
      for (const s of rvpScopes) {
        const r = rvpById.get(s.user_id);
        if (r) rvpByRegion.set(s.scope_id, r);
      }
    }
  }

  const entries = [];
  for (const p of profiles) {
    if (!p.birthday) continue;
    if (p.show_birthday === false) continue;
    if (!birthdayInWindow(p.birthday, start, end)) continue;

    const storeMeta = p.primary_store_id ? storeRegion.get(p.primary_store_id) : null;
    const regionId = storeMeta?.region_id ?? null;
    const rvp = regionId ? rvpByRegion.get(regionId) : null;
    const region = regionId ? regionById.get(regionId) : null;

    entries.push({
      id: p.id,
      name: p.preferred_name || p.full_name || p.email,
      role: p.role,
      birthday: p.birthday, // ISO YYYY-MM-DD
      store_number: storeMeta?.store_number ?? null,
      store_name: storeMeta?.store_name ?? null,
      region_id: regionId,
      region_name: region?.name ?? null,
      rvp_id: rvp?.id ?? null,
      rvp_name: rvp ? rvp.preferred_name || rvp.full_name : null,
    });
  }

  // Sort: month-day asc, then name asc.
  entries.sort((a, b) => {
    const ma = a.birthday.slice(5);
    const mb = b.birthday.slice(5);
    if (ma !== mb) return ma < mb ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { entries };
}

// ----------------------------------------------------------------------------
// update-store-vendor (POST)
// ----------------------------------------------------------------------------
//
// Whitelisted update of the 5 food-vendor fields on a store, with
// per-field audit rows. Plate IQ Email + Soar Company are intentionally
// NOT writable from this endpoint — they're admin / SQL only.
//
// Authorization:
//   - org-wide roles (admin/payroll/vp/coo): any store
//   - do/sdo/rvp: any store inside their visible scope
//   - gm: only the store matching their primary_store_id
//   - everyone else: 403

const VENDOR_EDITABLE_FIELDS = [
  "food_vendor_name",
  "food_vendor_contact_name",
  "food_vendor_contact_phone",
  "food_vendor_contact_email",
  "food_vendor_account_number",
];

async function callerCanEditStoreVendor(supa, user, storeId) {
  if (ORG_WIDE.has(user.role)) return true;
  if (user.role === "gm") {
    return user.primary_store_id === storeId;
  }
  if (["do", "sdo", "rvp"].includes(user.role)) {
    const visible = await callerVisibleStoreIds(supa, user);
    return visible.includes(storeId);
  }
  return false;
}

async function updateStoreVendor(supa, user, body) {
  const storeId = String(body?.store_id || "").trim();
  if (!storeId) return { error: "store_id required.", status: 400 };

  const allowed = await callerCanEditStoreVendor(supa, user, storeId);
  if (!allowed) return { error: "forbidden", status: 403 };

  // Whitelist + normalize. Empty / whitespace-only string -> null so
  // queries like `where food_vendor_name is null` behave predictably.
  const updates = {};
  for (const f of VENDOR_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, f)) continue;
    const raw = body[f];
    if (raw === null) {
      updates[f] = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      updates[f] = trimmed === "" ? null : trimmed;
    } else {
      return { error: `${f} must be a string or null.`, status: 400 };
    }
  }
  if (Object.keys(updates).length === 0) {
    return { error: "no updatable fields provided.", status: 400 };
  }

  const selectCols = "id, " + VENDOR_EDITABLE_FIELDS.join(", ");
  const { data: before, error: readErr } = await supa
    .from("stores")
    .select(selectCols)
    .eq("id", storeId)
    .single();
  if (readErr || !before) return { error: "store not found.", status: 404 };

  const { data: after, error: upErr } = await supa
    .from("stores")
    .update(updates)
    .eq("id", storeId)
    .select(selectCols)
    .single();
  if (upErr) return { error: upErr.message || "update failed.", status: 500 };

  // One audit row per field that actually changed.
  const auditRows = [];
  for (const f of Object.keys(updates)) {
    const oldVal = before[f] ?? null;
    const newVal = updates[f];
    if (oldVal !== newVal) {
      auditRows.push({
        store_id: storeId,
        actor_id: user.id,
        actor_email: user.email,
        field: f,
        old_value: oldVal,
        new_value: newVal,
      });
    }
  }
  if (auditRows.length) {
    await supa.from("store_vendor_audit").insert(auditRows);
  }

  return { store: after, changed: auditRows.length };
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

  let user;
  try {
    user = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "";

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "my-tree") return unwrap(await getMyTree(supa, user));
      if (action === "birthdays") return unwrap(await getBirthdays(supa, user, params));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return respond(400, { error: "invalid JSON body" });
      }
      if (action === "update-store-vendor") {
        return unwrap(await updateStoreVendor(supa, user, body));
      }
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
