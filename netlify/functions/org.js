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
//
// IMPORTANT: this expands upward from the caller's visible stores to
// the parent district / area / region scope rows, which means a DO
// scoped to one district sees the RVP of the entire region. That's
// the intended behavior for the leadership card on store detail (the
// chain of command upward), but it MUST NOT be used for the birthday
// widget — see callerStoreLevelProfiles below.
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

// Store-level profiles only — used by the birthday widget so that a
// caller scoped to a district doesn't see the birthday of the RVP of
// their parent region (callerVisibleProfiles intentionally expands
// upward; this one does not). Org-wide roles still see everyone.
async function callerStoreLevelProfiles(supa, user, visibleStoreIds) {
  const baseSelect =
    "id, email, phone, full_name, preferred_name, role, primary_store_id, is_active, birthday, show_birthday, profile_photo_url";

  if (ORG_WIDE.has(user.role)) {
    const { data } = await supa
      .from("profiles")
      .select(baseSelect)
      .eq("is_active", true);
    return data ?? [];
  }
  if (!visibleStoreIds.length) return [];
  const { data } = await supa
    .from("profiles")
    .select(baseSelect)
    .in("primary_store_id", visibleStoreIds)
    .eq("is_active", true);
  return data ?? [];
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
          "id, number, name, city, state, phone, email, address, district_id, is_active, " +
            "plate_iq_email, soar_company_name, food_vendor_name, " +
            "food_vendor_contact_name, food_vendor_contact_phone, " +
            "food_vendor_contact_email, food_vendor_account_number, " +
            "acquisition_date, pos_provider, security_vendor, security_vendor_phone, " +
            "has_apple_pay, has_order_ahead, has_outdoor_seating, " +
            "has_drive_thru, has_clearance_bar, drive_thru_lanes, drive_thru_type, " +
            "public_restroom_count, patio_pop_menu_count, patio_pop_stall_numbers, " +
            "order_ahead_stall_count, order_ahead_stall_numbers, stall_pop_menu_count, " +
            "has_trailer_stall, trailer_stall_number, third_party_delivery, attributes"
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
  // onto each store as the Leadership card data. We also pull 'store'
  // scopes here so GMs assigned via the Org Admin tree (which writes to
  // user_scopes rather than profile.primary_store_id) still resolve as
  // their store's GM in the Leadership card.
  const { data: scopeRows } = await supa
    .from("user_scopes")
    .select("user_id, scope_type, scope_id")
    .in("scope_type", ["store", "district", "area", "region"]);
  const scopedUserIds = Array.from(new Set((scopeRows ?? []).map((r) => r.user_id)));
  let scopedProfiles = [];
  if (scopedUserIds.length) {
    const { data } = await supa
      .from("profiles")
      .select(
        "id, email, phone, full_name, preferred_name, role, primary_store_id, is_active, profile_photo_url"
      )
      .in("id", scopedUserIds)
      .eq("is_active", true);
    scopedProfiles = data ?? [];
  }
  const profileById = new Map(scopedProfiles.map((p) => [p.id, p]));

  function findManager(role, scopeType, scopeId) {
    if (!scopeId) return null;
    const matches = (scopeRows ?? []).filter(
      (s) => s.scope_type === scopeType && s.scope_id === scopeId
        && profileById.get(s.user_id)?.role === role
    );
    if (matches.length === 0) return null;
    // Stable order: when more than one user has the same role + scope
    // (rare but possible during a transition), pick the lowest user_id
    // so the leadership card resolves to the SAME person across calls
    // instead of flipping based on database row order.
    matches.sort((a, b) => a.user_id.localeCompare(b.user_id));
    return profileById.get(matches[0].user_id);
  }

  // GM per store: union of two sources of truth, since the codebase has
  // historically wired GMs in two ways.
  //   (1) profile.primary_store_id pointing at the store (preferred — this
  //       is what PAF, birthdays, and team-members all key off).
  //   (2) a user_scopes row with scope_type='store' and the user's role='gm'
  //       (what the Org Admin tree writes when an admin assigns a GM via
  //       the org chart UI).
  // When both exist for the same store, source (1) wins because that's the
  // field the rest of the app reads from.
  const gmByStore = new Map();
  // Source (2) first so source (1) can overwrite.
  for (const row of scopeRows ?? []) {
    if (row.scope_type !== "store") continue;
    const p = profileById.get(row.user_id);
    if (p && p.role === "gm" && p.is_active) {
      gmByStore.set(row.scope_id, p);
    }
  }
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
                attributes: s.attributes ?? {},
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

// Upper bound on the birthday window. The widget is the only consumer
// today and asks for "this week + next week" (~14 days). birthdayInWindow
// compares MM-DD only, so a multi-month range trivially matches every
// birthday — putting an explicit cap here prevents an accidental or
// abusive client from exfiltrating the entire org's birthday list in
// one request.
const MAX_BIRTHDAY_WINDOW_DAYS = 60;

async function getBirthdays(supa, user, query) {
  const start = String(query?.start || "").trim();
  const end = String(query?.end || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: "start and end must be YYYY-MM-DD.", status: 400 };
  }
  const startMs = Date.parse(start + "T00:00:00Z");
  const endMs = Date.parse(end + "T00:00:00Z");
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { error: "Invalid date.", status: 400 };
  }
  if (endMs < startMs) {
    return { error: "end must be on or after start.", status: 400 };
  }
  const windowDays = Math.floor((endMs - startMs) / 86_400_000);
  if (windowDays > MAX_BIRTHDAY_WINDOW_DAYS) {
    return {
      error: `Date range too large (max ${MAX_BIRTHDAY_WINDOW_DAYS} days).`,
      status: 400,
    };
  }

  const visibleStoreIds = await callerVisibleStoreIds(supa, user);
  // Use the store-level-only profile helper, NOT callerVisibleProfiles.
  // The latter expands upward from visibleStoreIds to district/area/
  // region user_scopes rows, which would leak the birthday/photo of
  // higher-level managers (e.g. the RVP of the parent region) to a
  // DO who is only scoped to a single district.
  const profiles = await callerStoreLevelProfiles(supa, user, visibleStoreIds);

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
  if (["do", "sdo", "rvp"].includes(user.role)) {
    const visible = await callerVisibleStoreIds(supa, user);
    return visible.includes(storeId);
  }
  if (user.role === "gm") {
    // Standard path: profile.primary_store_id matches the target store.
    if (user.primary_store_id === storeId) return true;
    // Fallback for GMs whose profile.primary_store_id isn't populated
    // but who are correctly scoped via user_scopes to exactly one
    // store. Defensive: a GM with a misconfigured district/area scope
    // would have multiple stores in their visible set, and we do NOT
    // want them to gain district-wide edit rights through this branch.
    const visible = await callerVisibleStoreIds(supa, user);
    return visible.length === 1 && visible[0] === storeId;
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
    // supabase-js returns PostgREST errors in the result object — it
    // does NOT throw — so we have to destructure { error }. Without
    // this check a missing store_vendor_audit table (or RLS misfire)
    // would silently drop the audit trail while the store update
    // succeeds.
    const { error: auditErr } = await supa
      .from("store_vendor_audit")
      .insert(auditRows);
    if (auditErr) {
      console.warn("[org] store_vendor_audit insert failed", auditErr);
    }
  }

  return { store: after, changed: auditRows.length };
}

// ----------------------------------------------------------------------------
// update-store-attributes (POST)
// ----------------------------------------------------------------------------
//
// Edit programs / drive-thru / stall data / third-party delivery / free-
// form attributes from the My Stores → store detail gear icon. Available
// to anyone with store visibility above GM: admin, payroll, vp, coo
// (org-wide) and any do/sdo/rvp whose visible scope includes the store.
// GMs are NOT granted this path — they have vendor edit only.
//
// Plate IQ Email + Soar Company Name + store contact (email/phone/
// address) are intentionally NOT in this whitelist. Those stay
// admin-only via /admin/org.

const ATTRIBUTE_EDITABLE_FIELDS = [
  "has_apple_pay", "has_order_ahead", "has_outdoor_seating",
  "has_drive_thru", "has_clearance_bar",
  "drive_thru_lanes", "drive_thru_type",
  "public_restroom_count",
  "patio_pop_menu_count", "patio_pop_stall_numbers",
  "order_ahead_stall_count", "order_ahead_stall_numbers",
  "stall_pop_menu_count",
  "has_trailer_stall", "trailer_stall_number",
  "third_party_delivery",
  "attributes",
];

const ATTRIBUTE_BOOL_FIELDS = new Set([
  "has_apple_pay", "has_order_ahead", "has_outdoor_seating",
  "has_drive_thru", "has_clearance_bar", "has_trailer_stall",
]);
const ATTRIBUTE_COUNT_FIELDS = new Set([
  "public_restroom_count", "patio_pop_menu_count",
  "order_ahead_stall_count", "stall_pop_menu_count",
]);
const ATTRIBUTE_TEXT_FIELDS = new Set([
  "patio_pop_stall_numbers", "order_ahead_stall_numbers", "trailer_stall_number",
]);

// Limits for the free-form `attributes` jsonb bag. Conservative — bumps
// are cheap. Prevents a single store from becoming a 1 MB blob and
// keeps the admin UI tractable.
const ATTR_MAX_KEYS         = 50;
const ATTR_MAX_KEY_LENGTH   = 64;
const ATTR_MAX_VALUE_LENGTH = 500;
const ATTR_RESERVED_KEYS    = new Set(["__proto__", "constructor", "prototype"]);

// Validates + normalizes the free-form `attributes` payload. Returns
// either { ok: true, value } or { error }. Object identity is preserved
// (we don't mutate the caller's value).
function validateCustomAttributes(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "attributes must be an object." };
  }
  const keys = Object.keys(raw);
  if (keys.length > ATTR_MAX_KEYS) {
    return { error: `attributes can have at most ${ATTR_MAX_KEYS} entries.` };
  }
  const out = {};
  for (const key of keys) {
    if (ATTR_RESERVED_KEYS.has(key)) {
      return { error: `attribute key "${key}" is reserved.` };
    }
    const trimmedKey = String(key).trim();
    if (!trimmedKey) {
      return { error: "attribute keys cannot be empty." };
    }
    if (trimmedKey.length > ATTR_MAX_KEY_LENGTH) {
      return {
        error: `attribute key "${trimmedKey.slice(0, 20)}…" exceeds ${ATTR_MAX_KEY_LENGTH} characters.`,
      };
    }
    const value = raw[key];
    if (value === null) {
      out[trimmedKey] = null;
      continue;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && !Number.isFinite(value)) {
        return { error: `attribute "${trimmedKey}" has non-finite numeric value.` };
      }
      out[trimmedKey] = value;
      continue;
    }
    if (typeof value === "string") {
      if (value.length > ATTR_MAX_VALUE_LENGTH) {
        return {
          error: `attribute "${trimmedKey}" exceeds ${ATTR_MAX_VALUE_LENGTH} characters.`,
        };
      }
      out[trimmedKey] = value;
      continue;
    }
    return {
      error: `attribute "${trimmedKey}" must be a string, number, boolean, or null.`,
    };
  }
  return { ok: true, value: out };
}

async function callerCanEditStoreAttributes(supa, user, storeId) {
  if (ORG_WIDE.has(user.role)) return true;
  if (["do", "sdo", "rvp"].includes(user.role)) {
    const visible = await callerVisibleStoreIds(supa, user);
    return visible.includes(storeId);
  }
  // GMs and shift_managers do NOT get attribute edit access. GMs have
  // vendor edit; shift_managers have read-only My Stores.
  return false;
}

async function updateStoreAttributes(supa, user, body) {
  const storeId = String(body?.store_id || "").trim();
  if (!storeId) return { error: "store_id required.", status: 400 };

  const allowed = await callerCanEditStoreAttributes(supa, user, storeId);
  if (!allowed) return { error: "forbidden", status: 403 };

  const updates = {};
  for (const f of ATTRIBUTE_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, f)) continue;
    const raw = body[f];

    if (ATTRIBUTE_BOOL_FIELDS.has(f)) {
      if (typeof raw !== "boolean") {
        return { error: `${f} must be a boolean.`, status: 400 };
      }
      updates[f] = raw;
    } else if (ATTRIBUTE_COUNT_FIELDS.has(f)) {
      const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 9999) {
        return { error: `${f} must be a non-negative integer (<=9999).`, status: 400 };
      }
      updates[f] = n;
    } else if (f === "drive_thru_lanes") {
      if (raw === null) updates[f] = null;
      else if (raw === 1 || raw === 2) updates[f] = raw;
      else return { error: "drive_thru_lanes must be 1, 2, or null.", status: 400 };
    } else if (f === "drive_thru_type") {
      if (raw === null) updates[f] = null;
      else if (raw === "single_pole_two_menus" || raw === "split_housing") {
        updates[f] = raw;
      } else {
        return {
          error: "drive_thru_type must be single_pole_two_menus, split_housing, or null.",
          status: 400,
        };
      }
    } else if (f === "third_party_delivery") {
      if (!Array.isArray(raw)) {
        return { error: "third_party_delivery must be an array.", status: 400 };
      }
      for (const item of raw) {
        if (typeof item !== "string" || item.length > 50) {
          return {
            error: "third_party_delivery entries must be strings (max 50 chars).",
            status: 400,
          };
        }
      }
      updates[f] = raw;
    } else if (f === "attributes") {
      const result = validateCustomAttributes(raw);
      if (result.error) return { error: result.error, status: 400 };
      updates[f] = result.value;
    } else if (ATTRIBUTE_TEXT_FIELDS.has(f)) {
      if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
        updates[f] = null;
      } else if (typeof raw === "string") {
        if (raw.length > 200) {
          return { error: `${f} too long (max 200).`, status: 400 };
        }
        updates[f] = raw.trim();
      } else {
        return { error: `${f} must be a string or null.`, status: 400 };
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return { error: "no updatable fields provided.", status: 400 };
  }

  const selectCols = "id, " + ATTRIBUTE_EDITABLE_FIELDS.join(", ");
  const { data: after, error: upErr } = await supa
    .from("stores")
    .update(updates)
    .eq("id", storeId)
    .select(selectCols)
    .single();
  if (upErr) return { error: upErr.message || "update failed.", status: 500 };

  return { store: after, changed: Object.keys(updates).length };
}

// ----------------------------------------------------------------------------
// stores-geo (GET)
// ----------------------------------------------------------------------------
//
// The caller's editable stores with their current walkthrough geofence
// coordinates. Same audience as the geo editor: org-wide roles, or
// DO/SDO/RVP scoped to their visible stores.

async function listStoresGeo(supa, user) {
  const canAny = ORG_WIDE.has(user.role) || ["do", "sdo", "rvp"].includes(user.role);
  if (!canAny) return { error: "forbidden", status: 403 };

  let q = supa
    .from("stores")
    .select("id, number, name, city, state, latitude, longitude, geofence_radius_m")
    .eq("is_active", true)
    .order("number");
  if (!ORG_WIDE.has(user.role)) {
    const visible = await callerVisibleStoreIds(supa, user);
    if (!visible.length) return { stores: [] };
    q = q.in("id", visible);
  }
  const { data, error } = await q;
  if (error) return { error: error.message || "load failed.", status: 500 };
  return { stores: data ?? [] };
}

// ----------------------------------------------------------------------------
// update-store-geo (POST)
// ----------------------------------------------------------------------------
//
// Sets the store's coordinates + geofence radius used by the walkthrough
// GPS check-in (migration 0121). Same manage rule as attributes: org-wide
// roles, or DO/SDO/RVP for stores in their scope.

async function updateStoreGeo(supa, user, body) {
  const storeId = String(body?.store_id || "").trim();
  if (!storeId) return { error: "store_id required.", status: 400 };

  const allowed = await callerCanEditStoreAttributes(supa, user, storeId);
  if (!allowed) return { error: "forbidden", status: 403 };

  const updates = {};
  if (Object.prototype.hasOwnProperty.call(body, "latitude")) {
    const v = body.latitude;
    if (v === null) updates.latitude = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < -90 || n > 90) {
        return { error: "latitude must be between -90 and 90.", status: 400 };
      }
      updates.latitude = n;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "longitude")) {
    const v = body.longitude;
    if (v === null) updates.longitude = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < -180 || n > 180) {
        return { error: "longitude must be between -180 and 180.", status: 400 };
      }
      updates.longitude = n;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "geofence_radius_m")) {
    const n = parseInt(String(body.geofence_radius_m), 10);
    if (!Number.isFinite(n) || n < 10 || n > 5000) {
      return { error: "geofence_radius_m must be between 10 and 5000.", status: 400 };
    }
    updates.geofence_radius_m = n;
  }

  if (Object.keys(updates).length === 0) {
    return { error: "no geo fields provided.", status: 400 };
  }

  const { data: after, error: upErr } = await supa
    .from("stores")
    .update(updates)
    .eq("id", storeId)
    .select("id, latitude, longitude, geofence_radius_m")
    .single();
  if (upErr) return { error: upErr.message || "update failed.", status: 500 };

  return { store: after };
}

// ----------------------------------------------------------------------------
// store-vendor-audit (GET)
// ----------------------------------------------------------------------------
//
// Admin-only audit log for vendor-info changes on a store. Returns the
// most recent N rows from store_vendor_audit, enriched with the actor's
// name so the UI doesn't need a second roundtrip.

async function getStoreVendorAudit(supa, user, query) {
  if (user.role !== "admin") {
    return { error: "forbidden", status: 403 };
  }
  const storeId = String(query?.store_id || "").trim();
  if (!storeId) return { error: "store_id required.", status: 400 };
  const limit = Math.min(Math.max(parseInt(query?.limit, 10) || 50, 1), 200);

  const { data: rows, error } = await supa
    .from("store_vendor_audit")
    .select("id, store_id, actor_id, actor_email, field, old_value, new_value, created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { error: error.message, status: 500 };

  const actorIds = Array.from(
    new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean))
  );
  let actorById = {};
  if (actorIds.length) {
    const { data: actors } = await supa
      .from("profiles")
      .select("id, full_name, preferred_name, role")
      .in("id", actorIds);
    actorById = Object.fromEntries(
      (actors ?? []).map((a) => [
        a.id,
        {
          id: a.id,
          name: a.preferred_name || a.full_name || null,
          role: a.role,
        },
      ])
    );
  }

  return {
    entries: (rows ?? []).map((r) => ({
      id: r.id,
      store_id: r.store_id,
      field: r.field,
      old_value: r.old_value,
      new_value: r.new_value,
      created_at: r.created_at,
      actor: r.actor_id
        ? actorById[r.actor_id] ?? { id: r.actor_id, name: null, role: null }
        : { id: null, name: null, role: null },
      actor_email: r.actor_email,
    })),
  };
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
      if (action === "store-vendor-audit")
        return unwrap(await getStoreVendorAudit(supa, user, params));
      if (action === "stores-geo") return unwrap(await listStoresGeo(supa, user));
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
      if (action === "update-store-attributes") {
        return unwrap(await updateStoreAttributes(supa, user, body));
      }
      if (action === "update-store-geo") {
        return unwrap(await updateStoreGeo(supa, user, body));
      }
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
