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
  store: ["number", "name", "phone", "address", "city", "state", "zip", "is_active"],
};

// Parent column for "move" — store moves to a new district, district to
// a new area, area to a new region. Regions have no parent (move not
// supported; if you need it, that's a one-off SQL).
const PARENT_FIELD_FOR = {
  store: "district_id",
  district: "area_id",
  area: "region_id",
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

  // Build the insert payload, dropping unknown keys.
  const allowed = EDITABLE_FIELDS[kind];
  const insert = { is_active: true };
  for (const k of allowed) {
    if (body[k] !== undefined) insert[k] = body[k];
  }
  // Parent FK for non-region kinds.
  if (kind !== "region") {
    const fkField = PARENT_FIELD_FOR[kind];
    const fkValue = body[fkField];
    if (!fkValue) {
      return { error: `${fkField} is required.`, status: 400 };
    }
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
    if (body[k] !== undefined) updates[k] = body[k];
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

  const { error: updErr } = await supa
    .from(table)
    .update(updates)
    .eq("id", id);
  if (updErr) return { error: updErr.message, status: 500 };

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

  return { ok: true };
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
  if (!newParentId) return { error: `${fkField} is required.`, status: 400 };

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
    const code = String(row.code ?? "").trim();
    const name = String(row.name ?? "").trim();
    const number = String(row.number ?? "").trim();
    const parentCode = String(row.parent_code ?? "").trim();
    const isActive = parseBoolish(row.is_active);

    if (!ORG_KINDS.includes(kind)) {
      errors.push(`Invalid kind "${kind}". Must be region/area/district/store.`);
    }
    if (!name) errors.push("name is required.");

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

    return {
      row: i + 1,
      kind,
      code: code || null,
      name,
      number: number || null,
      phone: String(row.phone ?? "").trim() || null,
      address: String(row.address ?? "").trim() || null,
      city: String(row.city ?? "").trim() || null,
      state: String(row.state ?? "").trim() || null,
      zip: String(row.zip ?? "").trim() || null,
      parent_code: parentCode || null,
      is_active: isActive,
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

    try {
      if (r.action === "update") {
        const updates = { name: r.name, is_active: r.is_active };
        if (r.kind === "store") {
          updates.number = r.number;
          updates.phone = r.phone;
          updates.address = r.address;
          updates.city = r.city;
          updates.state = r.state;
          updates.zip = r.zip;
          if (parentId) updates.district_id = parentId;
        } else {
          updates.code = r.code;
          if (r.kind === "area" && parentId) updates.region_id = parentId;
          if (r.kind === "district" && parentId) updates.area_id = parentId;
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
        const insert = { name: r.name, is_active: r.is_active };
        if (r.kind === "store") {
          insert.number = r.number;
          insert.phone = r.phone;
          insert.address = r.address;
          insert.city = r.city;
          insert.state = r.state;
          insert.zip = r.zip;
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
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
