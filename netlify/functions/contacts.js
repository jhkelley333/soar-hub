// netlify/functions/contacts.js
//
// Three-tier contacts API. Writes go through this function (not direct
// PostgREST) so we get consistent server-side validation, normalization,
// and authz on top of the RLS policies in migration 0030.
//
// Actions:
//
//   GET  ?action=list                 — contacts visible to caller
//   GET  ?action=get&id=...           — single contact
//
//   POST ?action=create               — create a new contact
//   POST ?action=update               — partial update
//   POST ?action=delete               — delete (audit-logged via trigger)
//   POST ?action=hide                 — add caller's primary store to
//                                        the contact's hidden_for_store_ids
//   POST ?action=unhide               — remove caller's primary store
//   POST ?action=pin                  — add to caller's pinned_contact_ids
//   POST ?action=unpin                — remove
//
// Authorization mirrors the RLS policies in 0030:
//   - admin / org-wide roles: any tier
//   - regional writes: caller has leadership reach (district/area/region
//     /global scope) AND the region is in their visible regions
//   - store writes: caller's visible stores include the target store
//   - GMs and shift_managers can only write to their own store's
//     contacts (regional writes are blocked by the leadership-reach check)
//
// Vendor-bridged contacts (contact_type='vendor' + vendor_id set) just
// hold the contact-shaped fields; the vendor record holds the full
// vendor data. UI fetches both via the vendor_id and renders the merged
// view.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const ORG_WIDE = new Set(["payroll", "admin", "vp", "coo"]);
const LEADERSHIP_REACH_SCOPES = new Set(["district", "area", "region", "global"]);

const CONTACT_TYPES = new Set(["person", "vendor", "internal_team", "corporate"]);
const TIERS = new Set(["company", "regional", "area", "district", "store"]);
const POS_FILTERS = new Set(["infor", "micros"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("contacts env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// User-scoped client. Reads issued through this client go through
// PostgREST as the caller, so RLS in 0030 filters rows automatically.
// Writes keep using admin() because the audit-log inserts need to
// bypass the no-policy RLS on the audit tables.
function userClient(token) {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("contacts env vars not configured (anon key)");
  }
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, primary_store_id, is_active, pinned_contact_ids")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return { profile, token };
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

// ----------------------------------------------------------------------------
// Authorization helpers — mirror the RLS policies in 0030 so a function-
// layer rejection is consistent with what RLS would have done anyway.
// ----------------------------------------------------------------------------

async function callerVisibleStoreIds(supa, user) {
  if (ORG_WIDE.has(user.role)) {
    const { data } = await supa.from("stores").select("id").eq("is_active", true);
    return new Set((data ?? []).map((s) => s.id));
  }
  const { data } = await supa.rpc("user_visible_stores", { uid: user.id });
  return new Set(
    (data ?? [])
      .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
      .filter(Boolean)
  );
}

async function callerVisibleRegionIds(supa, user) {
  const { data } = await supa.rpc("user_visible_regions", { uid: user.id });
  return new Set(
    (data ?? [])
      .map((v) => (typeof v === "string" ? v : v?.user_visible_regions ?? null))
      .filter(Boolean)
  );
}

async function callerVisibleAreaIds(supa, user) {
  const { data } = await supa.rpc("user_visible_areas", { uid: user.id });
  return new Set(
    (data ?? [])
      .map((v) => (typeof v === "string" ? v : v?.user_visible_areas ?? null))
      .filter(Boolean)
  );
}

async function callerVisibleDistrictIds(supa, user) {
  const { data } = await supa.rpc("user_visible_districts", { uid: user.id });
  return new Set(
    (data ?? [])
      .map((v) => (typeof v === "string" ? v : v?.user_visible_districts ?? null))
      .filter(Boolean)
  );
}

async function callerHasLeadershipReach(supa, user) {
  if (ORG_WIDE.has(user.role)) return true;
  const { data } = await supa
    .from("user_scopes")
    .select("scope_type")
    .eq("user_id", user.id);
  return (data ?? []).some((s) => LEADERSHIP_REACH_SCOPES.has(s.scope_type));
}

async function callerCanWriteContact(supa, user, contact) {
  const { tier, region_id, area_id, district_id, store_id } = contact;
  if (ORG_WIDE.has(user.role)) return true;
  if (tier === "company") return false; // only admin / org-wide
  if (tier === "regional") {
    if (!region_id) return false;
    if (!(await callerHasLeadershipReach(supa, user))) return false;
    const regions = await callerVisibleRegionIds(supa, user);
    return regions.has(region_id);
  }
  if (tier === "area") {
    if (!area_id) return false;
    if (!(await callerHasLeadershipReach(supa, user))) return false;
    const areas = await callerVisibleAreaIds(supa, user);
    return areas.has(area_id);
  }
  if (tier === "district") {
    if (!district_id) return false;
    if (!(await callerHasLeadershipReach(supa, user))) return false;
    const districts = await callerVisibleDistrictIds(supa, user);
    return districts.has(district_id);
  }
  if (tier === "store") {
    if (!store_id) return false;
    const stores = await callerVisibleStoreIds(supa, user);
    return stores.has(store_id);
  }
  return false;
}

// ----------------------------------------------------------------------------
// Input shape helpers
// ----------------------------------------------------------------------------

function normString(raw, maxLen = 200) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v === "") return null;
  return v.slice(0, maxLen);
}

function normEmail(raw) {
  const v = normString(raw, 200);
  return v ? v.toLowerCase() : null;
}

function validateScopeShape(body) {
  const tier = body?.tier;
  if (!TIERS.has(tier)) {
    return { error: "tier must be company/regional/area/district/store." };
  }
  const region_id   = tier === "regional" ? normString(body?.region_id, 100)   : null;
  const area_id     = tier === "area"     ? normString(body?.area_id, 100)     : null;
  const district_id = tier === "district" ? normString(body?.district_id, 100) : null;
  const store_id    = tier === "store"    ? normString(body?.store_id, 100)    : null;
  if (tier === "regional" && !region_id)   return { error: "region_id required for regional tier." };
  if (tier === "area"     && !area_id)     return { error: "area_id required for area tier." };
  if (tier === "district" && !district_id) return { error: "district_id required for district tier." };
  if (tier === "store"    && !store_id)    return { error: "store_id required for store tier." };
  return { tier, region_id, area_id, district_id, store_id };
}

function buildContactPayload(body, { skipScope = false } = {}) {
  const out = {};
  // Identifiers
  if (body?.display_name !== undefined) {
    const v = normString(body.display_name, 200);
    if (!v) return { error: "display_name is required." };
    out.display_name = v;
  }
  if (body?.contact_type !== undefined) {
    if (!CONTACT_TYPES.has(body.contact_type)) {
      return { error: "contact_type must be person/vendor/internal_team/corporate." };
    }
    out.contact_type = body.contact_type;
  }
  // Contact fields
  for (const f of ["phone", "extension", "website", "notes", "category"]) {
    if (body?.[f] !== undefined) out[f] = normString(body[f], 500);
  }
  if (body?.email !== undefined) out.email = normEmail(body.email);
  // pos_filter
  if (body?.pos_filter !== undefined) {
    if (body.pos_filter === null || body.pos_filter === "") {
      out.pos_filter = null;
    } else if (!POS_FILTERS.has(body.pos_filter)) {
      return { error: "pos_filter must be infor/micros/null." };
    } else {
      out.pos_filter = body.pos_filter;
    }
  }
  // Vendor bridge
  if (body?.vendor_id !== undefined) {
    out.vendor_id = body.vendor_id ? normString(body.vendor_id, 100) : null;
  }
  // Scope
  if (!skipScope) {
    const scope = validateScopeShape(body);
    if (scope.error) return scope;
    out.tier = scope.tier;
    out.region_id = scope.region_id;
    out.area_id = scope.area_id;
    out.district_id = scope.district_id;
    out.store_id = scope.store_id;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

async function listContacts(userSupa) {
  // Issued through the caller's JWT — RLS policies in migration 0030
  // filter the row set down to what the caller is allowed to see.
  const { data, error } = await userSupa
    .from("contacts")
    .select("*")
    .order("display_name");
  if (error) return { error: error.message, status: 500 };
  return { contacts: data ?? [] };
}

async function getContact(userSupa, query) {
  const id = String(query?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };
  // RLS gates the SELECT — a hidden row returns null (treated as 404).
  const { data, error } = await userSupa.from("contacts").select("*").eq("id", id).maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found.", status: 404 };
  return { contact: data };
}

async function createContact(supa, user, body) {
  const payload = buildContactPayload(body);
  if (payload.error) return { error: payload.error, status: 400 };
  if (!payload.display_name) return { error: "display_name is required.", status: 400 };

  const allowed = await callerCanWriteContact(supa, user, payload);
  if (!allowed) return { error: "forbidden", status: 403 };

  payload.created_by = user.id;
  const { data, error } = await supa.from("contacts").insert(payload).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { contact: data };
}

async function updateContact(supa, user, body) {
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };

  // Pull existing to check authz against current scope (and reject
  // attempts to silently re-tier a row).
  const { data: existing } = await supa.from("contacts").select("*").eq("id", id).maybeSingle();
  if (!existing) return { error: "Not found.", status: 404 };

  const allowed = await callerCanWriteContact(supa, user, existing);
  if (!allowed) return { error: "forbidden", status: 403 };

  // Re-tiering: only admin/org-wide allowed.
  if (body?.tier !== undefined && body.tier !== existing.tier && !ORG_WIDE.has(user.role)) {
    return { error: "Only admins can change a contact's tier.", status: 403 };
  }

  const payload = buildContactPayload(body, { skipScope: body?.tier === undefined });
  if (payload.error) return { error: payload.error, status: 400 };
  delete payload.created_by;
  if (Object.keys(payload).length === 0) {
    return { error: "no updatable fields provided.", status: 400 };
  }

  const { data, error } = await supa
    .from("contacts").update(payload).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { contact: data };
}

async function deleteContact(supa, user, body) {
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };
  const { data: existing } = await supa.from("contacts").select("*").eq("id", id).maybeSingle();
  if (!existing) return { error: "Not found.", status: 404 };
  const allowed = await callerCanWriteContact(supa, user, existing);
  if (!allowed) return { error: "forbidden", status: 403 };
  const { error } = await supa.from("contacts").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function hideContact(supa, user, body, { hide }) {
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };
  if (!user.primary_store_id) {
    return { error: "Only users with a primary store can hide regional contacts.", status: 400 };
  }
  const { data: existing } = await supa
    .from("contacts").select("id, tier, hidden_for_store_ids").eq("id", id).maybeSingle();
  if (!existing) return { error: "Not found.", status: 404 };
  if (!["regional", "area", "district"].includes(existing.tier)) {
    return {
      error: "Only regional/area/district contacts can be hidden per-store.",
      status: 400,
    };
  }
  const current = new Set(existing.hidden_for_store_ids ?? []);
  if (hide) current.add(user.primary_store_id);
  else current.delete(user.primary_store_id);
  const { error } = await supa
    .from("contacts")
    .update({ hidden_for_store_ids: Array.from(current) })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  // Log the hide/unhide as an explicit action (the generic update
  // trigger fires with 'update', so we add a clarifying row).
  await supa.from("contact_audit_log").insert({
    contact_id: id,
    changed_by: user.id,
    action: hide ? "hide" : "unhide",
    changes: { store_id: user.primary_store_id },
  });

  return { ok: true };
}

async function pinContact(supa, userSupa, user, body, { pin }) {
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };
  // Only pin contacts the caller can actually see. RLS via userSupa
  // returns null for hidden rows — treat that as 404 so phantom IDs
  // can't pile up in pinned_contact_ids.
  if (pin) {
    const { data: visible } = await userSupa
      .from("contacts").select("id").eq("id", id).maybeSingle();
    if (!visible) return { error: "Not found.", status: 404 };
  }
  const current = new Set(user.pinned_contact_ids ?? []);
  if (pin) current.add(id);
  else current.delete(id);
  const { error } = await supa
    .from("profiles")
    .update({ pinned_contact_ids: Array.from(current) })
    .eq("id", user.id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true, pinned: Array.from(current) };
}

// Scope options for the contact-edit form. Returns the regions /
// areas / districts / stores the caller can target with a contact,
// based on their role + user_scopes. The UI uses this to populate
// the dropdowns under each tier — so a DO with district scope sees
// only their districts (plus their stores) and CAN'T accidentally
// select an area outside their reach. Admin / org-wide get everything.
async function scopeOptions(supa, user) {
  // Resolve caller's reach.
  const visibleStoreIds  = Array.from(await callerVisibleStoreIds(supa, user));
  const visibleRegionIds = ORG_WIDE.has(user.role)
    ? null  // null = "all"
    : Array.from(await callerVisibleRegionIds(supa, user));
  const visibleAreaIds = ORG_WIDE.has(user.role)
    ? null
    : Array.from(await callerVisibleAreaIds(supa, user));
  const visibleDistrictIds = ORG_WIDE.has(user.role)
    ? null
    : Array.from(await callerVisibleDistrictIds(supa, user));

  const [
    { data: regions },
    { data: areas },
    { data: districts },
    { data: stores },
  ] = await Promise.all([
    visibleRegionIds === null
      ? supa.from("regions").select("id, code, name").order("code")
      : visibleRegionIds.length
        ? supa.from("regions").select("id, code, name").in("id", visibleRegionIds).order("code")
        : Promise.resolve({ data: [] }),
    visibleAreaIds === null
      ? supa.from("areas").select("id, code, name, region_id").order("code")
      : visibleAreaIds.length
        ? supa.from("areas").select("id, code, name, region_id").in("id", visibleAreaIds).order("code")
        : Promise.resolve({ data: [] }),
    visibleDistrictIds === null
      ? supa.from("districts").select("id, code, name, area_id").order("code")
      : visibleDistrictIds.length
        ? supa.from("districts").select("id, code, name, area_id").in("id", visibleDistrictIds).order("code")
        : Promise.resolve({ data: [] }),
    ORG_WIDE.has(user.role)
      ? supa.from("stores").select("id, number, name, district_id").eq("is_active", true).order("number")
      : visibleStoreIds.length
        ? supa.from("stores").select("id, number, name, district_id").in("id", visibleStoreIds).eq("is_active", true).order("number")
        : Promise.resolve({ data: [] }),
  ]);

  // Caller can write at region/area/district tiers only if they have
  // leadership reach. Admin always can. Bundle the flag so the UI can
  // hide / disable tier options the user can't actually use.
  const writeTiers = new Set();
  writeTiers.add("store"); // anyone with visible stores
  if (ORG_WIDE.has(user.role)) writeTiers.add("company");
  if (await callerHasLeadershipReach(supa, user)) {
    if ((regions ?? []).length)   writeTiers.add("regional");
    if ((areas ?? []).length)     writeTiers.add("area");
    if ((districts ?? []).length) writeTiers.add("district");
  }

  return {
    regions: regions ?? [],
    areas: areas ?? [],
    districts: districts ?? [],
    stores: stores ?? [],
    writeable_tiers: Array.from(writeTiers),
  };
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------

function unwrap(result) {
  if (result && typeof result === "object" && "status" in result && "error" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let session;
  try {
    session = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!session) return respond(401, { error: "unauthorized" });
  const { profile: user, token } = session;

  const params = event.queryStringParameters || {};
  const action = params.action || "";

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listContacts(userClient(token)));
      if (action === "get") return unwrap(await getContact(userClient(token), params));
      if (action === "scope-options") return unwrap(await scopeOptions(supa, user));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return respond(400, { error: "invalid JSON body" });
      }
      if (action === "create")  return unwrap(await createContact(supa, user, body));
      if (action === "update")  return unwrap(await updateContact(supa, user, body));
      if (action === "delete")  return unwrap(await deleteContact(supa, user, body));
      if (action === "hide")    return unwrap(await hideContact(supa, user, body, { hide: true }));
      if (action === "unhide")  return unwrap(await hideContact(supa, user, body, { hide: false }));
      if (action === "pin")     return unwrap(await pinContact(supa, userClient(token), user, body, { pin: true }));
      if (action === "unpin")   return unwrap(await pinContact(supa, userClient(token), user, body, { pin: false }));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
