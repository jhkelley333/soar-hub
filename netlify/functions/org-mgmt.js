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
//
// Bulk attribute set/delete actions (admin-only):
//
//   POST /.netlify/functions/org-mgmt?action=bulk-attribute-preview
//   POST /.netlify/functions/org-mgmt?action=bulk-attribute-apply
//     body: {
//       scope: { type: "all" }
//            | { type: "region",   id: uuid }
//            | { type: "area",     id: uuid }
//            | { type: "district", id: uuid },
//       key:    string,
//       value:  string | number | boolean | null   (ignored when delete=true)
//       delete: boolean                            (default false)
//       confirm: true                              (apply only)
//     }
//   Preview returns the resolved store list + how many already have the
//   key. Apply writes stores.attributes and logs one store_attribute_audit
//   row per affected store with a shared bulk_operation_id.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

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
        "id, number, name, phone, email, address, city, state, zip, district_id, is_active, " +
        "plate_iq_email, soar_company_name, " +
        "acquisition_date, pos_provider, security_vendor, food_vendor_name, " +
        "has_apple_pay, has_order_ahead, has_outdoor_seating, has_drive_thru, has_clearance_bar, " +
        "drive_thru_lanes, drive_thru_type, public_restroom_count, " +
        "patio_pop_menu_count, patio_pop_stall_numbers, " +
        "order_ahead_stall_count, order_ahead_stall_numbers, stall_pop_menu_count, " +
        "has_trailer_stall, trailer_stall_number, third_party_delivery"
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
      email: s.email,
      address: s.address,
      city: s.city,
      state: s.state,
      zip: s.zip,
      is_active: s.is_active,
      plate_iq_email: s.plate_iq_email,
      soar_company_name: s.soar_company_name,
      acquisition_date: s.acquisition_date,
      pos_provider: s.pos_provider,
      security_vendor: s.security_vendor,
      food_vendor_name: s.food_vendor_name,
      has_apple_pay: s.has_apple_pay,
      has_order_ahead: s.has_order_ahead,
      has_outdoor_seating: s.has_outdoor_seating,
      has_drive_thru: s.has_drive_thru,
      has_clearance_bar: s.has_clearance_bar,
      drive_thru_lanes: s.drive_thru_lanes,
      drive_thru_type: s.drive_thru_type,
      public_restroom_count: s.public_restroom_count,
      patio_pop_menu_count: s.patio_pop_menu_count,
      patio_pop_stall_numbers: s.patio_pop_stall_numbers,
      order_ahead_stall_count: s.order_ahead_stall_count,
      order_ahead_stall_numbers: s.order_ahead_stall_numbers,
      stall_pop_menu_count: s.stall_pop_menu_count,
      has_trailer_stall: s.has_trailer_stall,
      trailer_stall_number: s.trailer_stall_number,
      third_party_delivery: s.third_party_delivery ?? [],
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
// Write actions (admin only) — create / rename / move / toggle is_active
// for regions, areas, districts, stores. Every successful write inserts an
// org_changes row so we can answer "who renamed Frisco DFW 1 to DFW 1A?"
// ----------------------------------------------------------------------------

// target_kind enum values (from migration 0008/0009).
// 'market' is preserved as a historical label — new writes use 'area'.
const TARGET_KINDS = new Set(["region", "area", "district", "store"]);
const ORG_ACTIONS = new Set(["create", "update", "move", "deactivate", "reactivate"]);

const TABLE_FOR = {
  region: "regions",
  area: "areas",
  district: "districts",
  store: "stores",
};

// Which fields can the rename/edit endpoint actually change. Other
// columns (created_at, etc.) are immutable through this API.
const EDITABLE_FIELDS = {
  region: ["code", "name", "is_active"],
  area: ["code", "name", "is_active"],
  district: ["code", "name", "is_active"],
  store: [
    "number", "name",
    "phone", "email", "address", "city", "state", "zip",
    "is_active",
    "plate_iq_email", "soar_company_name",
    "acquisition_date", "pos_provider", "security_vendor", "food_vendor_name",
    "has_apple_pay", "has_order_ahead", "has_outdoor_seating",
    "has_drive_thru", "has_clearance_bar",
    "drive_thru_lanes", "drive_thru_type",
    "public_restroom_count",
    "patio_pop_menu_count", "patio_pop_stall_numbers",
    "order_ahead_stall_count", "order_ahead_stall_numbers",
    "stall_pop_menu_count",
    "has_trailer_stall", "trailer_stall_number",
    "third_party_delivery",
  ],
};

// Per-field validators. Run after the EDITABLE_FIELDS allowlist filter
// — guarantees no unrelated body keys reach this layer. Each rule
// returns either { value: <coerced> } or { error: "..." }. Empty
// strings on nullable fields coerce to null so `where ... is null`
// queries behave predictably; empty on required fields fails.
const FIELD_RULES = {
  code:    { type: "string",  maxLen: 50,  trim: true, required: true },
  name:    { type: "string",  maxLen: 200, trim: true, required: true },
  number:  { type: "string",  maxLen: 20,  trim: true, required: true },
  phone:   { type: "phone10", nullable: true },
  email:   { type: "string",  maxLen: 200, trim: true, nullable: true },
  address: { type: "string",  maxLen: 200, trim: true, nullable: true },
  city:    { type: "string",  maxLen: 100, trim: true, nullable: true },
  state:   { type: "string",  maxLen: 50,  trim: true, nullable: true },
  zip:     { type: "string",  maxLen: 20,  trim: true, nullable: true },
  is_active: { type: "boolean" },
  // Operations / vendor (admin-only, edited via Org admin or bulk import):
  plate_iq_email:    { type: "string", maxLen: 200, trim: true, nullable: true },
  soar_company_name: { type: "string", maxLen: 200, trim: true, nullable: true },
  // Acquisition / vendor metadata. Strict ISO date so legacy M/D/Y input
  // doesn't get coerced into the wrong day by the PG date parser.
  acquisition_date:  { type: "date",   nullable: true },
  pos_provider:      { type: "string", maxLen: 100, trim: true, nullable: true },
  security_vendor:   { type: "string", maxLen: 100, trim: true, nullable: true },
  food_vendor_name:  { type: "string", maxLen: 200, trim: true, nullable: true },
  // Active programs (booleans):
  has_apple_pay:        { type: "boolean" },
  has_order_ahead:      { type: "boolean" },
  has_outdoor_seating:  { type: "boolean" },
  has_drive_thru:       { type: "boolean" },
  has_clearance_bar:    { type: "boolean" },
  // Drive-thru detail:
  drive_thru_lanes: { type: "intEnum", values: [1, 2], nullable: true },
  drive_thru_type:  { type: "stringEnum", values: ["single_pole_two_menus", "split_housing"], nullable: true },
  // Counts:
  public_restroom_count:   { type: "int", min: 0, max: 99 },
  patio_pop_menu_count:    { type: "int", min: 0, max: 999 },
  order_ahead_stall_count: { type: "int", min: 0, max: 999 },
  stall_pop_menu_count:    { type: "int", min: 0, max: 999 },
  // Stall numbers (free-text comma lists):
  patio_pop_stall_numbers:   { type: "string", maxLen: 200, trim: true, nullable: true },
  order_ahead_stall_numbers: { type: "string", maxLen: 200, trim: true, nullable: true },
  // Trailer stall:
  has_trailer_stall:    { type: "boolean" },
  trailer_stall_number: { type: "string", maxLen: 50, trim: true, nullable: true },
  // Third-party delivery: JSON array of provider keys.
  third_party_delivery: { type: "stringArray", maxLen: 50 },
};

function validateField(key, raw) {
  const rule = FIELD_RULES[key];
  if (!rule) return { error: `Field "${key}" is not validated.` };

  // null / empty-string handling first.
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
    if (rule.required) return { error: `"${key}" is required.` };
    if (rule.type === "boolean") return { value: false };
    if (rule.type === "int") return { value: 0 };
    if (rule.type === "stringArray") return { value: [] };
    return { value: null };
  }

  if (rule.type === "boolean") {
    // Accept literal booleans and the same string set parseBoolish handles.
    if (typeof raw === "boolean") return { value: raw };
    if (typeof raw === "string") {
      const s = raw.trim().toLowerCase();
      if (["true", "t", "yes", "y", "1"].includes(s)) return { value: true };
      if (["false", "f", "no", "n", "0"].includes(s)) return { value: false };
    }
    return { error: `"${key}" must be true or false.` };
  }

  if (rule.type === "phone10") {
    const digits = String(raw).replace(/\D/g, "");
    const trimmed = digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits;
    if (trimmed.length !== 10) {
      return { error: `"${key}" must be a 10-digit phone number.` };
    }
    return { value: trimmed };
  }

  if (rule.type === "string") {
    if (typeof raw !== "string") {
      return { error: `"${key}" must be a string.` };
    }
    const v = rule.trim ? raw.trim() : raw;
    if (rule.maxLen && v.length > rule.maxLen) {
      return { error: `"${key}" is too long (max ${rule.maxLen} chars).` };
    }
    return { value: v };
  }

  if (rule.type === "stringEnum") {
    if (typeof raw !== "string") return { error: `"${key}" must be a string.` };
    const v = raw.trim();
    if (!rule.values.includes(v)) {
      return { error: `"${key}" must be one of: ${rule.values.join(", ")}.` };
    }
    return { value: v };
  }

  if (rule.type === "int") {
    const n = typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { error: `"${key}" must be an integer.` };
    }
    if (rule.min !== undefined && n < rule.min) {
      return { error: `"${key}" must be >= ${rule.min}.` };
    }
    if (rule.max !== undefined && n > rule.max) {
      return { error: `"${key}" must be <= ${rule.max}.` };
    }
    return { value: n };
  }

  if (rule.type === "intEnum") {
    const n = typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
    if (!rule.values.includes(n)) {
      return { error: `"${key}" must be one of: ${rule.values.join(", ")}.` };
    }
    return { value: n };
  }

  if (rule.type === "date") {
    // Strict YYYY-MM-DD only. Anything else (M/D/Y, MM-DD-YY) is
    // rejected because PG's date parser will silently accept some of
    // those under the wrong DateStyle and store the wrong day.
    if (typeof raw !== "string") return { error: `"${key}" must be a date string.` };
    const s = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { error: `"${key}" must be a date in YYYY-MM-DD format.` };
    }
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return { error: `"${key}" is not a valid date.` };
    // Re-format to canonical YYYY-MM-DD so a value like "2026-2-3"
    // (which the regex above already rejects) can't sneak through.
    return { value: s };
  }

  if (rule.type === "stringArray") {
    // Accept either a JS array or a comma-separated string (for CSV).
    let arr;
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === "string") {
      arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      return { error: `"${key}" must be an array or comma-separated string.` };
    }
    for (const item of arr) {
      if (typeof item !== "string") {
        return { error: `"${key}" entries must be strings.` };
      }
      if (rule.maxLen && item.length > rule.maxLen) {
        return { error: `"${key}" entry is too long (max ${rule.maxLen}).` };
      }
    }
    return { value: arr };
  }

  return { error: `Unknown validator type for "${key}".` };
}

// Parent column for "move" — store moves to a new district, district to
// a new area, area to a new region. Regions have no parent (move not
// supported; if you need it, that's a one-off SQL).
const PARENT_FIELD_FOR = {
  store: "district_id",
  district: "area_id",
  area: "region_id",
};

// Parent kind / table — used to verify the new parent on a move
// actually exists and is the correct kind. Without this, an admin (or
// a compromised admin token) could orphan a node under a UUID that
// points to nothing or to a wrong-kind row.
const PARENT_TABLE_FOR = {
  store: "districts",
  district: "areas",
  area: "regions",
};

async function logOrgChange(supa, { actor_id, target_kind, target_id, action, before, after }) {
  try {
    // supabase-js returns PostgREST errors in the result object — it
    // does NOT throw — so we have to destructure { error }. A bare
    // try/catch around the insert silently drops failed audit rows.
    const { error } = await supa.from("org_changes").insert({
      actor_id,
      target_kind,
      target_id,
      action,
      before: before ?? null,
      after: after ?? null,
    });
    if (error) console.warn("[org-mgmt] audit log insert failed", error);
  } catch (e) {
    console.warn("[org-mgmt] audit log insert threw", e);
  }
}

// Compute the diff between a fresh-pull row and the requested updates.
// Only includes keys whose value changed. Used so audit before/after only
// carry what actually moved.
function diffRows(beforeRow, updates) {
  const before = {};
  const after = {};
  for (const k of Object.keys(updates)) {
    const a = beforeRow?.[k] ?? null;
    const b = updates[k] ?? null;
    if (a !== b) {
      before[k] = a;
      after[k] = b;
    }
  }
  return { before, after };
}

function requireAdmin(user) {
  if (user.role !== "admin") {
    return { error: "Admin only.", status: 403 };
  }
  return null;
}

// ---------- create ----------

async function createOrgNode(supa, user, body) {
  const adminCheck = requireAdmin(user);
  if (adminCheck) return adminCheck;

  const kind = String(body?.kind ?? "");
  if (!TARGET_KINDS.has(kind)) {
    return { error: `Unknown kind: ${kind}`, status: 400 };
  }
  const table = TABLE_FOR[kind];

  // Build the insert payload, dropping unknown keys + validating values.
  const allowed = EDITABLE_FIELDS[kind];
  const insert = { is_active: true };
  for (const k of allowed) {
    if (body[k] === undefined) continue;
    const result = validateField(k, body[k]);
    if (result.error) return { error: result.error, status: 400 };
    insert[k] = result.value;
  }
  // Parent FK for non-region kinds. Verify the parent exists AND is
  // the correct kind so an admin can't orphan a node under a stale or
  // wrong-kind UUID.
  if (kind !== "region") {
    const fkField = PARENT_FIELD_FOR[kind];
    const fkValue = body[fkField];
    if (!fkValue || typeof fkValue !== "string") {
      return { error: `${fkField} is required.`, status: 400 };
    }
    const parentTable = PARENT_TABLE_FOR[kind];
    const { count, error: parentErr } = await supa
      .from(parentTable)
      .select("id", { head: true, count: "exact" })
      .eq("id", fkValue);
    if (parentErr) return { error: parentErr.message, status: 500 };
    if (!count) return { error: `${fkField} ${fkValue} does not exist.`, status: 400 };
    insert[fkField] = fkValue;
  }

  // Minimal required-field validation.
  if (kind === "store") {
    if (!insert.number) return { error: "Store number is required.", status: 400 };
    if (!insert.name) return { error: "Store name is required.", status: 400 };
  } else {
    if (!insert.code) return { error: `${kind} code is required.`, status: 400 };
    if (!insert.name) return { error: `${kind} name is required.`, status: 400 };
  }

  const { data: created, error } = await supa
    .from(table)
    .insert(insert)
    .select("*")
    .single();
  if (error) return { error: error.message, status: 500 };

  await logOrgChange(supa, {
    actor_id: user.id,
    target_kind: kind,
    target_id: created.id,
    action: "create",
    before: null,
    after: insert,
  });

  return { ok: true, node: created };
}

// ---------- update (rename / edit fields) ----------

async function updateOrgNode(supa, user, body) {
  const adminCheck = requireAdmin(user);
  if (adminCheck) return adminCheck;

  const kind = String(body?.kind ?? "");
  if (!TARGET_KINDS.has(kind)) {
    return { error: `Unknown kind: ${kind}`, status: 400 };
  }
  const id = body?.id;
  if (!id) return { error: "id is required.", status: 400 };

  const table = TABLE_FOR[kind];
  const allowed = EDITABLE_FIELDS[kind];

  const updates = {};
  for (const k of allowed) {
    if (body[k] === undefined) continue;
    const result = validateField(k, body[k]);
    if (result.error) return { error: result.error, status: 400 };
    updates[k] = result.value;
  }
  // Treat is_active separately so we can record deactivate/reactivate
  // as their own audit actions.
  let action = "update";
  let isActiveChange = null;
  if ("is_active" in updates) {
    isActiveChange = updates.is_active;
  }

  if (Object.keys(updates).length === 0) {
    return { error: "No fields to update.", status: 400 };
  }

  // Pull the before snapshot so audit captures the diff.
  const { data: beforeRow, error: beforeErr } = await supa
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (beforeErr) return { error: beforeErr.message, status: 500 };
  if (!beforeRow) return { error: "Not found.", status: 404 };

  const { data: updatedRow, error: updErr } = await supa
    .from(table)
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (updErr) return { error: updErr.message, status: 500 };
  if (!updatedRow) {
    // Either the row vanished mid-update or the service-role write
    // affected 0 rows. Either way the client thinks the save worked
    // but the data didn't move — surface a real error instead.
    return {
      error: "Update affected 0 rows. The record may have been deleted.",
      status: 404,
    };
  }

  // Defensive read-back: compare what we asked Postgres to set against
  // what came back. If any field didn't persist (silent trigger, RLS
  // policy on a column, etc.), refuse to lie to the caller.
  const drift = [];
  for (const k of Object.keys(updates)) {
    const want = updates[k];
    const got  = updatedRow[k];
    // Loose compare so null/"" and 1/true equivalents don't flag as drift.
    const same =
      (want === null && (got === null || got === undefined)) ||
      (typeof want === "boolean" && !!got === want) ||
      (Array.isArray(want) && Array.isArray(got) && JSON.stringify(want) === JSON.stringify(got)) ||
      (String(want ?? "") === String(got ?? ""));
    if (!same) drift.push({ field: k, sent: want, saved: got });
  }
  if (drift.length) {
    console.warn("[org-mgmt] update drift", { kind, id, drift });
    return {
      error:
        `Some fields didn't persist: ${drift.map((d) => d.field).join(", ")}. ` +
        `Check column constraints or triggers.`,
      status: 500,
    };
  }

  if (isActiveChange === true && beforeRow.is_active === false) {
    action = "reactivate";
  } else if (isActiveChange === false && beforeRow.is_active === true) {
    action = "deactivate";
  }

  const { before, after } = diffRows(beforeRow, updates);
  await logOrgChange(supa, {
    actor_id: user.id,
    target_kind: kind,
    target_id: id,
    action,
    before,
    after,
  });

  return { ok: true, node: updatedRow };
}

// ---------- move (parent reassignment) ----------

async function moveOrgNode(supa, user, body) {
  const adminCheck = requireAdmin(user);
  if (adminCheck) return adminCheck;

  const kind = String(body?.kind ?? "");
  if (kind === "region") {
    return { error: "Regions cannot be moved.", status: 400 };
  }
  if (!TARGET_KINDS.has(kind)) {
    return { error: `Unknown kind: ${kind}`, status: 400 };
  }
  const id = body?.id;
  const fkField = PARENT_FIELD_FOR[kind];
  const newParentId = body?.[fkField];
  if (!id) return { error: "id is required.", status: 400 };
  if (!newParentId || typeof newParentId !== "string") {
    return { error: `${fkField} is required.`, status: 400 };
  }

  const table = TABLE_FOR[kind];

  const { data: beforeRow, error: beforeErr } = await supa
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (beforeErr) return { error: beforeErr.message, status: 500 };
  if (!beforeRow) return { error: "Not found.", status: 404 };

  if (beforeRow[fkField] === newParentId) {
    return { ok: true }; // no-op
  }

  // Verify the new parent exists AND is the right kind. Postgres has
  // an FK constraint that would also reject a non-existent UUID, but
  // (a) the error surface is uglier, and (b) this catches stale
  // client state earlier with a clearer message.
  const parentTable = PARENT_TABLE_FOR[kind];
  const { count: parentCount, error: parentErr } = await supa
    .from(parentTable)
    .select("id", { head: true, count: "exact" })
    .eq("id", newParentId);
  if (parentErr) return { error: parentErr.message, status: 500 };
  if (!parentCount) {
    return { error: `${fkField} ${newParentId} does not exist.`, status: 400 };
  }

  const { error: updErr } = await supa
    .from(table)
    .update({ [fkField]: newParentId })
    .eq("id", id);
  if (updErr) return { error: updErr.message, status: 500 };

  await logOrgChange(supa, {
    actor_id: user.id,
    target_kind: kind,
    target_id: id,
    action: "move",
    before: { [fkField]: beforeRow[fkField] },
    after: { [fkField]: newParentId },
  });

  return { ok: true };
}

// ---------- history (admin-only audit feed) ----------

async function fetchOrgHistory(supa, user, query) {
  const adminCheck = requireAdmin(user);
  if (adminCheck) return adminCheck;

  const kind = query?.target_kind || null;
  const targetId = query?.target_id || null;
  const limit = Math.min(parseInt(query?.limit || "50", 10) || 50, 200);

  let q = supa
    .from("org_changes")
    .select("id, actor_id, target_kind, target_id, action, before, after, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (kind) q = q.eq("target_kind", kind);
  if (targetId) q = q.eq("target_id", targetId);

  const { data: rows, error } = await q;
  if (error) return { error: error.message, status: 500 };
  if (!rows || rows.length === 0) return { entries: [] };

  const actorIds = [...new Set(rows.map((r) => r.actor_id))];
  const { data: actors } = await supa
    .from("profiles")
    .select("id, full_name, email")
    .in("id", actorIds);
  const actorMap = Object.fromEntries((actors ?? []).map((a) => [a.id, a]));

  return {
    entries: rows.map((r) => ({
      id: r.id,
      target_kind: r.target_kind,
      target_id: r.target_id,
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
// Bulk attribute set / delete (admin-only)
// ----------------------------------------------------------------------------

// Limits mirror the single-store editor in netlify/functions/org.js +
// the My Stores → Manage attributes drawer. Keep these aligned.
const BULK_ATTR_MAX_KEY_LENGTH   = 64;
const BULK_ATTR_MAX_VALUE_LENGTH = 500;
const BULK_ATTR_RESERVED_KEYS    = new Set(["__proto__", "constructor", "prototype"]);
// Sanity cap on how big a single bulk apply can be. 5000 stores is
// well above realistic franchise size; mostly here to bound worst-case
// audit-insert latency.
const BULK_ATTR_MAX_STORES = 5000;

function validateBulkKey(raw) {
  if (typeof raw !== "string") return { error: "key must be a string." };
  const trimmed = raw.trim();
  if (!trimmed) return { error: "key cannot be empty." };
  if (trimmed.length > BULK_ATTR_MAX_KEY_LENGTH) {
    return { error: `key exceeds ${BULK_ATTR_MAX_KEY_LENGTH} characters.` };
  }
  if (BULK_ATTR_RESERVED_KEYS.has(trimmed)) {
    return { error: `key "${trimmed}" is reserved.` };
  }
  return { value: trimmed };
}

// Coerces + validates a single value (the "set" payload). Mirrors the
// validateCustomAttributes per-value logic in org.js. delete=true
// callers should skip this entirely.
function validateBulkValue(raw) {
  if (raw === null) return { value: null };
  if (typeof raw === "boolean") return { value: raw };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return { error: "numeric value must be finite." };
    }
    return { value: raw };
  }
  if (typeof raw === "string") {
    if (raw.length > BULK_ATTR_MAX_VALUE_LENGTH) {
      return { error: `value exceeds ${BULK_ATTR_MAX_VALUE_LENGTH} characters.` };
    }
    return { value: raw };
  }
  return { error: "value must be a string, number, boolean, or null." };
}

// Resolve a scope spec to the array of active store rows it covers.
// Returns { error } on bad input, { stores } otherwise. Each store row
// includes the current attributes bag so callers can compute deltas
// without a second roundtrip.
async function resolveScopeStores(supa, scope) {
  if (!scope || typeof scope !== "object") {
    return { error: "scope is required." };
  }
  const type = String(scope.type || "").trim();

  if (type === "all") {
    const { data, error } = await supa
      .from("stores")
      .select("id, number, name, attributes")
      .eq("is_active", true)
      .order("number");
    if (error) return { error: error.message };
    return { stores: data ?? [] };
  }

  if (!["region", "area", "district"].includes(type)) {
    return { error: `Unknown scope type: ${type}` };
  }
  const id = String(scope.id || "").trim();
  if (!id) return { error: `scope.id is required for type "${type}".` };

  // Walk the org tree downward to collect district ids in scope, then
  // pull active stores whose district_id is in that set.
  let districtIds = [];
  if (type === "district") {
    districtIds = [id];
  } else if (type === "area") {
    const { data, error } = await supa
      .from("districts")
      .select("id")
      .eq("area_id", id);
    if (error) return { error: error.message };
    districtIds = (data ?? []).map((d) => d.id);
  } else if (type === "region") {
    const { data: areas, error: areaErr } = await supa
      .from("areas")
      .select("id")
      .eq("region_id", id);
    if (areaErr) return { error: areaErr.message };
    const areaIds = (areas ?? []).map((a) => a.id);
    if (areaIds.length === 0) return { stores: [] };
    const { data: dists, error: distErr } = await supa
      .from("districts")
      .select("id")
      .in("area_id", areaIds);
    if (distErr) return { error: distErr.message };
    districtIds = (dists ?? []).map((d) => d.id);
  }

  if (districtIds.length === 0) return { stores: [] };

  const { data: stores, error } = await supa
    .from("stores")
    .select("id, number, name, attributes")
    .in("district_id", districtIds)
    .eq("is_active", true)
    .order("number");
  if (error) return { error: error.message };
  return { stores: stores ?? [] };
}

// Returns the human-readable label of a scope ("All stores",
// "Region Frisco DFW 1", etc.). Used in audit messages + preview UI.
async function describeScope(supa, scope) {
  if (!scope) return "(no scope)";
  if (scope.type === "all") return "All stores";
  const table =
    scope.type === "region" ? "regions" :
    scope.type === "area" ? "areas" :
    scope.type === "district" ? "districts" : null;
  if (!table) return `(unknown scope ${scope.type})`;
  const { data } = await supa
    .from(table)
    .select("code, name")
    .eq("id", scope.id)
    .maybeSingle();
  if (!data) return `(missing ${scope.type})`;
  const label =
    data.code && data.name && data.code !== data.name
      ? `${data.code} — ${data.name}`
      : data.name || data.code;
  return `${scope.type.charAt(0).toUpperCase() + scope.type.slice(1)} ${label}`;
}

async function bulkAttributePreview(supa, user, body) {
  const adminCheck = requireAdmin(user);
  if (adminCheck) return adminCheck;

  const keyResult = validateBulkKey(body?.key);
  if (keyResult.error) return { error: keyResult.error, status: 400 };
  const key = keyResult.value;

  const isDelete = !!body?.delete;
  let value;
  if (!isDelete) {
    const v = validateBulkValue(body?.value);
    if (v.error) return { error: v.error, status: 400 };
    value = v.value;
  }

  const scoped = await resolveScopeStores(supa, body?.scope);
  if (scoped.error) return { error: scoped.error, status: 400 };
  const stores = scoped.stores;
  if (stores.length > BULK_ATTR_MAX_STORES) {
    return {
      error: `Scope resolves to ${stores.length} stores; max ${BULK_ATTR_MAX_STORES} per operation.`,
      status: 400,
    };
  }

  const sample = stores.slice(0, 20).map((s) => ({
    id: s.id,
    number: s.number,
    name: s.name,
  }));
  const alreadyHasKey = stores.filter(
    (s) => s.attributes && Object.prototype.hasOwnProperty.call(s.attributes, key)
  ).length;
  // For delete: only count stores that actually have the key today,
  // because deleting a missing key is a no-op (we'd want to skip the
  // write in apply anyway).
  const willChange = isDelete
    ? alreadyHasKey
    : stores.filter((s) => {
        if (!s.attributes || !Object.prototype.hasOwnProperty.call(s.attributes, key)) {
          return true; // setting a new key always changes
        }
        return s.attributes[key] !== value;
      }).length;
  return {
    scope_label: await describeScope(supa, body.scope),
    operation: isDelete ? "delete" : "set",
    key,
    value: isDelete ? undefined : value,
    in_scope_count: stores.length,
    already_has_key_count: alreadyHasKey,
    will_change_count: willChange,
    sample_stores: sample,
  };
}

async function bulkAttributeApply(supa, user, body) {
  const adminCheck = requireAdmin(user);
  if (adminCheck) return adminCheck;

  if (body?.confirm !== true) {
    return { error: "confirm: true is required on apply.", status: 400 };
  }
  const keyResult = validateBulkKey(body?.key);
  if (keyResult.error) return { error: keyResult.error, status: 400 };
  const key = keyResult.value;

  const isDelete = !!body?.delete;
  let value;
  if (!isDelete) {
    const v = validateBulkValue(body?.value);
    if (v.error) return { error: v.error, status: 400 };
    value = v.value;
  }

  const scoped = await resolveScopeStores(supa, body?.scope);
  if (scoped.error) return { error: scoped.error, status: 400 };
  const stores = scoped.stores;
  if (stores.length > BULK_ATTR_MAX_STORES) {
    return {
      error: `Scope resolves to ${stores.length} stores; max ${BULK_ATTR_MAX_STORES} per operation.`,
      status: 400,
    };
  }

  const bulkOpId = randomUUID();
  const auditRows = [];
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const s of stores) {
    const current = s.attributes && typeof s.attributes === "object" ? s.attributes : {};
    const hasKey = Object.prototype.hasOwnProperty.call(current, key);
    const oldValue = hasKey ? current[key] : null;

    let nextAttrs;
    if (isDelete) {
      if (!hasKey) {
        skipped++;
        continue;
      }
      nextAttrs = { ...current };
      delete nextAttrs[key];
    } else {
      if (hasKey && current[key] === value) {
        skipped++;
        continue;
      }
      nextAttrs = { ...current, [key]: value };
    }

    const { error: upErr } = await supa
      .from("stores")
      .update({ attributes: nextAttrs })
      .eq("id", s.id);
    if (upErr) {
      errors.push({ store_id: s.id, number: s.number, error: upErr.message });
      continue;
    }
    updated++;
    auditRows.push({
      store_id: s.id,
      actor_id: user.id,
      actor_email: user.email,
      attribute_key: key,
      old_value: hasKey ? oldValue : null,
      new_value: isDelete ? null : value,
      action: isDelete ? "delete" : "set",
      bulk_operation_id: bulkOpId,
    });
  }

  if (auditRows.length) {
    // chunk in 500s to keep INSERT payloads small.
    for (let i = 0; i < auditRows.length; i += 500) {
      const chunk = auditRows.slice(i, i + 500);
      const { error: auditErr } = await supa
        .from("store_attribute_audit")
        .insert(chunk);
      if (auditErr) {
        console.warn("[org-mgmt] store_attribute_audit insert failed", auditErr);
        // Don't fail the whole apply if audit insert fails — surface
        // through response so the UI can warn.
        errors.push({ store_id: null, error: `audit log failed: ${auditErr.message}` });
        break;
      }
    }
  }

  return {
    bulk_operation_id: bulkOpId,
    operation: isDelete ? "delete" : "set",
    key,
    in_scope_count: stores.length,
    updated,
    skipped,
    errors,
  };
}

// ----------------------------------------------------------------------------
// Bulk import (admin only) — preview + commit a flat CSV that mixes all
// four org kinds in a single file. Existing rows (matched by code, or
// by number for stores) are UPDATED; missing rows are INSERTED. Each
// successful operation logs to org_changes with action 'create' or
// 'update'. Insertion runs in dependency order (region → area →
// district → store) so newly created parents are available before
// their children.
// ----------------------------------------------------------------------------

const ORG_KINDS = ["region", "area", "district", "store"];

function parseBoolish(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "" || s === "true" || s === "t" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "f" || s === "0" || s === "no" || s === "n") return false;
  return true;
}

// Bulk-import cells use SKIP-IF-EMPTY semantics — a column missing
// from the CSV (or present with an empty value) is treated as
// "don't change this field". To explicitly clear a value, use the
// literal string "NULL" (case-insensitive) in the cell.
//
// Returns:
//   undefined — the cell was not present, or was empty; skip on update.
//   null      — explicit clear ("NULL"); will set the column to null.
//   string    — the trimmed value.
function bulkCell(row, key) {
  if (!(key in row)) return undefined;
  const v = row[key];
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (s === "") return undefined;
  if (s.toLowerCase() === "null") return null;
  return s;
}

// Boolean cell with SKIP-IF-EMPTY semantics. Accepts the same string
// set parseBoolish does for non-empty values.
function bulkBoolCell(row, key) {
  const raw = bulkCell(row, key);
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).toLowerCase();
  if (["true", "t", "yes", "y", "1"].includes(s)) return true;
  if (["false", "f", "no", "n", "0"].includes(s)) return false;
  return undefined; // unrecognized → treat as skip rather than poison the row
}

// Integer cell with SKIP-IF-EMPTY semantics.
function bulkIntCell(row, key) {
  const raw = bulkCell(row, key);
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : undefined;
}

// Date cell with strict YYYY-MM-DD parsing. Pushes a per-row error on
// any other format so the bulk preview surfaces the bad cell to the
// admin instead of relying on PG's locale-sensitive date parser at
// insert time.
function bulkDateCell(row, key, errors) {
  const raw = bulkCell(row, key);
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    errors.push(`"${key}" must be YYYY-MM-DD (got "${s}").`);
    return undefined;
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    errors.push(`"${key}" is not a valid date (got "${s}").`);
    return undefined;
  }
  return s;
}

// JSON-array cell from a comma-separated string. SKIP-IF-EMPTY.
function bulkArrayCell(row, key) {
  const raw = bulkCell(row, key);
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

async function orgBulkValidate(supa, rows) {
  const [
    { data: regions },
    { data: areas },
    { data: districts },
    { data: stores },
  ] = await Promise.all([
    supa.from("regions").select("id, code, name, is_active"),
    supa.from("areas").select("id, code, name, region_id, is_active"),
    supa.from("districts").select("id, code, name, area_id, is_active"),
    supa
      .from("stores")
      .select("id, number, name, district_id, phone, address, city, state, zip, is_active"),
  ]);

  const regionByCode = Object.fromEntries((regions ?? []).map((r) => [r.code, r]));
  const areaByCode = Object.fromEntries((areas ?? []).map((a) => [a.code, a]));
  const districtByCode = Object.fromEntries((districts ?? []).map((d) => [d.code, d]));
  const storeByNum = Object.fromEntries((stores ?? []).map((s) => [String(s.number), s]));

  // Track entities staged earlier in the same CSV so children rows can
  // reference newly added parents (no UUID yet at validate-time, but we
  // know it'll exist by the time import runs).
  const stagedRegionCodes = new Set();
  const stagedAreaCodes = new Set();
  const stagedDistrictCodes = new Set();

  return rows.map((row, i) => {
    const errors = [];
    const warnings = [];
    const kind = String(row.kind ?? "").toLowerCase().trim();
    // The structural fields (code/name/number/parent_code) are NOT
    // optional in the same way attribute fields are. They identify
    // the row, so we read them eagerly and validate.
    const code = String(row.code ?? "").trim();
    const name = String(row.name ?? "").trim();
    const number = String(row.number ?? "").trim();
    const parentCode = String(row.parent_code ?? "").trim();

    if (!ORG_KINDS.includes(kind)) {
      errors.push(`Invalid kind "${kind}". Must be region/area/district/store.`);
    }

    let action = "create";
    let existing = null;
    let parentId = null;

    if (kind === "region") {
      if (!code) errors.push("code required for region.");
      else {
        existing = regionByCode[code];
        if (existing) action = "update";
        stagedRegionCodes.add(code);
      }
    } else if (kind === "area") {
      if (!code) errors.push("code required for area.");
      if (!parentCode) errors.push("parent_code (region code) required for area.");
      else {
        const parent = regionByCode[parentCode];
        if (parent) parentId = parent.id;
        else if (!stagedRegionCodes.has(parentCode)) {
          errors.push(`Parent region "${parentCode}" not found.`);
        }
      }
      if (code) {
        existing = areaByCode[code];
        if (existing) action = "update";
        stagedAreaCodes.add(code);
      }
    } else if (kind === "district") {
      if (!code) errors.push("code required for district.");
      if (!parentCode) errors.push("parent_code (area code) required for district.");
      else {
        const parent = areaByCode[parentCode];
        if (parent) parentId = parent.id;
        else if (!stagedAreaCodes.has(parentCode)) {
          errors.push(`Parent area "${parentCode}" not found.`);
        }
      }
      if (code) {
        existing = districtByCode[code];
        if (existing) action = "update";
        stagedDistrictCodes.add(code);
      }
    } else if (kind === "store") {
      if (!number) errors.push("number required for store.");
      if (!parentCode) errors.push("parent_code (district code) required for store.");
      else {
        const parent = districtByCode[parentCode];
        if (parent) parentId = parent.id;
        else if (!stagedDistrictCodes.has(parentCode)) {
          errors.push(`Parent district "${parentCode}" not found.`);
        }
      }
      if (number) {
        existing = storeByNum[number];
        if (existing) action = "update";
      }
    }

    // Name is required for create. On update, an empty/missing name
    // means "don't touch the name" (partial-update semantics).
    if (action === "create" && !name) {
      errors.push("name is required for new rows.");
    }

    return {
      row: i + 1,
      kind,
      // Identifiers — null when missing.
      code: code || null,
      name: name || null,
      number: number || null,
      parent_code: parentCode || null,
      // Editable fields — undefined means "skip / don't update". null
      // means "set to null". On create we coalesce undefined → safe
      // defaults at write time (see orgBulkImport).
      phone:                     bulkCell(row, "phone"),
      email:                     bulkCell(row, "email"),
      address:                   bulkCell(row, "address"),
      city:                      bulkCell(row, "city"),
      state:                     bulkCell(row, "state"),
      zip:                       bulkCell(row, "zip"),
      plate_iq_email:            bulkCell(row, "plate_iq_email"),
      soar_company_name:         bulkCell(row, "soar_company_name"),
      acquisition_date:          bulkDateCell(row, "acquisition_date", errors),
      pos_provider:              bulkCell(row, "pos_provider"),
      security_vendor:           bulkCell(row, "security_vendor"),
      food_vendor_name:          bulkCell(row, "food_vendor_name"),
      has_apple_pay:             bulkBoolCell(row, "has_apple_pay"),
      has_order_ahead:           bulkBoolCell(row, "has_order_ahead"),
      has_outdoor_seating:       bulkBoolCell(row, "has_outdoor_seating"),
      has_drive_thru:            bulkBoolCell(row, "has_drive_thru"),
      has_clearance_bar:         bulkBoolCell(row, "has_clearance_bar"),
      drive_thru_lanes:          bulkIntCell(row, "drive_thru_lanes"),
      drive_thru_type:           bulkCell(row, "drive_thru_type"),
      public_restroom_count:     bulkIntCell(row, "public_restroom_count"),
      patio_pop_menu_count:      bulkIntCell(row, "patio_pop_menu_count"),
      patio_pop_stall_numbers:   bulkCell(row, "patio_pop_stall_numbers"),
      order_ahead_stall_count:   bulkIntCell(row, "order_ahead_stall_count"),
      order_ahead_stall_numbers: bulkCell(row, "order_ahead_stall_numbers"),
      stall_pop_menu_count:      bulkIntCell(row, "stall_pop_menu_count"),
      has_trailer_stall:         bulkBoolCell(row, "has_trailer_stall"),
      trailer_stall_number:      bulkCell(row, "trailer_stall_number"),
      third_party_delivery:      bulkArrayCell(row, "third_party_delivery"),
      // is_active — same SKIP-IF-EMPTY semantics. Existing CSVs with
      // empty is_active used to silently set true; that was wrong on
      // updates and is now skipped instead.
      is_active:                 bulkBoolCell(row, "is_active"),
      action,
      existing_id: existing?.id ?? null,
      parent_id: parentId,
      errors,
      warnings,
    };
  });
}

async function orgBulkPreview(supa, user, body) {
  if (user.role !== "admin") return { error: "Admin only.", status: 403 };
  const rows = body?.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "No rows to preview.", status: 400 };
  }
  if (rows.length > 1000) {
    return { error: "Bulk import is capped at 1000 rows per upload.", status: 400 };
  }
  const annotated = await orgBulkValidate(supa, rows);
  const summary = {
    total: annotated.length,
    create: annotated.filter((r) => r.action === "create" && r.errors.length === 0).length,
    update: annotated.filter((r) => r.action === "update" && r.errors.length === 0).length,
    invalid: annotated.filter((r) => r.errors.length > 0).length,
  };
  return { rows: annotated, summary };
}

async function orgBulkImport(supa, user, body) {
  if (user.role !== "admin") return { error: "Admin only.", status: 403 };
  const rows = body?.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "No rows to import.", status: 400 };
  }
  const annotated = await orgBulkValidate(supa, rows);

  // Sort by dependency order so a newly created parent is available
  // before its children rows run.
  const order = { region: 0, area: 1, district: 2, store: 3 };
  const sorted = [...annotated].sort(
    (a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99) || a.row - b.row
  );

  const newRegionByCode = {};
  const newAreaByCode = {};
  const newDistrictByCode = {};

  const TABLE = {
    region: "regions",
    area: "areas",
    district: "districts",
    store: "stores",
  };

  const results = [];
  for (const r of sorted) {
    if (r.errors.length > 0) {
      results.push({ ...r, status: "error", message: r.errors.join("; ") });
      continue;
    }

    // Resolve parent_id at run-time (might have been created earlier in
    // this same batch).
    let parentId = r.parent_id;
    if (r.kind !== "region" && !parentId && r.parent_code) {
      const map =
        r.kind === "area"
          ? newRegionByCode
          : r.kind === "district"
            ? newAreaByCode
            : newDistrictByCode;
      parentId = map[r.parent_code] ?? null;
    }
    if (r.kind !== "region" && !parentId) {
      results.push({
        ...r,
        status: "error",
        message: `Parent ${r.parent_code} not found at import time.`,
      });
      continue;
    }

    // Helper: copy any defined keys from `r` onto `target`. Undefined
    // values mean "the CSV said to skip this column", so we leave the
    // existing DB value alone on update (or fall back to column
    // defaults on insert). nulls flow through — they're explicit
    // clears from the literal "NULL" CSV cell.
    function pickDefined(target, keys) {
      for (const k of keys) {
        if (r[k] !== undefined) target[k] = r[k];
      }
    }

    const STORE_FIELDS = [
      "phone", "email", "address", "city", "state", "zip",
      "plate_iq_email", "soar_company_name",
      "acquisition_date", "pos_provider", "security_vendor", "food_vendor_name",
      "has_apple_pay", "has_order_ahead", "has_outdoor_seating",
      "has_drive_thru", "has_clearance_bar",
      "drive_thru_lanes", "drive_thru_type",
      "public_restroom_count",
      "patio_pop_menu_count", "patio_pop_stall_numbers",
      "order_ahead_stall_count", "order_ahead_stall_numbers",
      "stall_pop_menu_count",
      "has_trailer_stall", "trailer_stall_number",
      "third_party_delivery",
    ];

    try {
      if (r.action === "update") {
        const updates = {};
        if (r.name) updates.name = r.name;
        if (r.is_active !== undefined && r.is_active !== null) {
          updates.is_active = r.is_active;
        }
        if (r.kind === "store") {
          if (r.number) updates.number = r.number;
          pickDefined(updates, STORE_FIELDS);
          if (parentId) updates.district_id = parentId;
        } else {
          if (r.code) updates.code = r.code;
          if (r.kind === "area" && parentId) updates.region_id = parentId;
          if (r.kind === "district" && parentId) updates.area_id = parentId;
        }
        if (Object.keys(updates).length === 0) {
          results.push({ ...r, status: "updated", node_id: r.existing_id, message: "No changes." });
          continue;
        }
        const { error } = await supa
          .from(TABLE[r.kind])
          .update(updates)
          .eq("id", r.existing_id);
        if (error) {
          results.push({ ...r, status: "error", message: error.message });
          continue;
        }
        await logOrgChange(supa, {
          actor_id: user.id,
          target_kind: r.kind,
          target_id: r.existing_id,
          action: "update",
          before: null,
          after: updates,
        });
        results.push({ ...r, status: "updated", node_id: r.existing_id });
      } else {
        // Create — required fields always present (validated above).
        const insert = { name: r.name };
        // is_active defaults to true at column level if not explicitly set.
        if (r.is_active !== undefined && r.is_active !== null) {
          insert.is_active = r.is_active;
        }
        if (r.kind === "store") {
          insert.number = r.number;
          pickDefined(insert, STORE_FIELDS);
          insert.district_id = parentId;
        } else {
          insert.code = r.code;
          if (r.kind === "area") insert.region_id = parentId;
          if (r.kind === "district") insert.area_id = parentId;
        }
        const { data: created, error } = await supa
          .from(TABLE[r.kind])
          .insert(insert)
          .select("id")
          .single();
        if (error) {
          results.push({ ...r, status: "error", message: error.message });
          continue;
        }
        if (r.kind === "region" && r.code) newRegionByCode[r.code] = created.id;
        if (r.kind === "area" && r.code) newAreaByCode[r.code] = created.id;
        if (r.kind === "district" && r.code) newDistrictByCode[r.code] = created.id;
        await logOrgChange(supa, {
          actor_id: user.id,
          target_kind: r.kind,
          target_id: created.id,
          action: "create",
          before: null,
          after: insert,
        });
        results.push({ ...r, status: "created", node_id: created.id });
      }
    } catch (e) {
      results.push({ ...r, status: "error", message: String(e?.message ?? e) });
    }
  }

  const summary = {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
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
    if (event.httpMethod === "GET") {
      if (action === "tree") return respond(200, await buildTree(supa));
      if (action === "history") {
        return unwrap(await fetchOrgHistory(supa, user, params));
      }
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "create") return unwrap(await createOrgNode(supa, user, body));
      if (action === "update") return unwrap(await updateOrgNode(supa, user, body));
      if (action === "move") return unwrap(await moveOrgNode(supa, user, body));
      if (action === "bulk-preview") return unwrap(await orgBulkPreview(supa, user, body));
      if (action === "bulk-import") return unwrap(await orgBulkImport(supa, user, body));
      if (action === "bulk-attribute-preview") {
        return unwrap(await bulkAttributePreview(supa, user, body));
      }
      if (action === "bulk-attribute-apply") {
        return unwrap(await bulkAttributeApply(supa, user, body));
      }
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
