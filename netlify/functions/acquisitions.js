// Acquisition staging + go-live merge. Admin/VP/COO stage an upcoming deal's
// stores (with intended region/area/district + GM), review them, then "merge"
// to create them as ACTIVE stores — building any missing org hierarchy — so
// they light up across the whole hub (Org, Territory Map, labor, ranking, …).
//
//   GET  ?action=list                  -> acquisitions + counts
//   GET  ?action=get&id=..             -> one acquisition + staged stores + validation
//   POST ?action=create   {name, close_date, notes}
//   POST ?action=update   {id, name, close_date, notes}
//   POST ?action=delete   {id}                    (draft only)
//   POST ?action=upload   {id, rows:[...]}        (replaces the staged set)
//   POST ?action=update-store {store_id, ...}
//   POST ?action=delete-store {store_id}
//   POST ?action=merge    {id}                    -> create active stores + org
//   POST ?action=unmerge  {id}                    -> deactivate what a merge created
//
// Service-role gatekeeper: RLS on, no policies.
import { createClient } from "@supabase/supabase-js";
import { geocodeConfigured, geocodeStoreOnWrite } from "./_lib/geocode.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MANAGE_ROLES = new Set(["admin", "vp", "coo"]);

function admin() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function respond(statusCode, payload) { return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }; }
const displayName = (p) => (p ? p.preferred_name || p.full_name || p.email || null : null);
const clean = (v, n = 500) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  const { data: { user } = {} } = await supa.auth.getUser(token);
  if (!user) return null;
  const { data: p } = await supa.from("profiles").select("id, role, is_active, full_name, preferred_name, email").eq("id", user.id).maybeSingle();
  return p && p.is_active ? { id: p.id, role: String(p.role || "").toLowerCase(), name: displayName(p) } : null;
}

// ── Org node create-or-find (by name, scoped to the parent) with a unique code.
function slugCode(name) {
  const s = String(name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
  return s || "NODE";
}
async function uniqueCode(supa, table, base) {
  let code = base;
  for (let i = 2; i < 200; i++) {
    const { data } = await supa.from(table).select("id").eq("code", code).maybeSingle();
    if (!data) return code;
    code = `${base}-${i}`.slice(0, 40);
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 40);
}
async function findOrCreate(supa, table, name, parentField, parentId, cache) {
  const key = `${table}:${parentId || ""}:${String(name).toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  let q = supa.from(table).select("id").ilike("name", String(name).trim());
  if (parentField) q = q.eq(parentField, parentId);
  const { data: found } = await q.limit(1).maybeSingle();
  if (found) { cache.set(key, found.id); return found.id; }
  const insert = { name: String(name).trim(), code: await uniqueCode(supa, table, slugCode(name)) };
  if (parentField) insert[parentField] = parentId;
  const { data: created, error } = await supa.from(table).insert(insert).select("id").maybeSingle();
  if (error) throw new Error(`Couldn't create ${table} "${name}": ${error.message}`);
  cache.set(key, created.id);
  return created.id;
}

// ── Validation for one staged store (what merge will/won't be able to do).
function validateStore(s, existingNumbers) {
  const issues = [];
  if (!s.store_number) issues.push("missing store #");
  if (!s.region_name || !s.area_name || !s.district_name) issues.push("needs region + area + district (a store must have a district)");
  if (s.store_number && existingNumbers.has(String(s.store_number))) issues.push("store # already exists in the hub");
  return issues;
}

async function acquisitionStores(supa, id) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supa.from("acquisition_stores").select("*").eq("acquisition_id", id).order("store_number").range(from, from + 999);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export const handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "acquisitions env vars not configured" });
    const supa = admin();
    const user = await sessionUser(supa, event);
    if (!user) return respond(401, { error: "unauthorized" });
    if (!MANAGE_ROLES.has(user.role)) return respond(403, { error: "Acquisitions are Admin / VP / COO only." });

    const params = event.queryStringParameters || {};
    const action = params.action || "list";

    if (event.httpMethod === "GET" && action === "list") {
      const { data: acqs, error } = await supa.from("acquisitions").select("*").order("created_at", { ascending: false });
      if (error) {
        if (/acquisitions/.test(error.message)) return respond(500, { error: "Run migration 0288 first (acquisitions is missing)." });
        return respond(500, { error: error.message });
      }
      const ids = (acqs || []).map((a) => a.id);
      const counts = new Map();
      if (ids.length) {
        const { data: rows } = await supa.from("acquisition_stores").select("acquisition_id, merged_store_id").in("acquisition_id", ids);
        for (const r of rows || []) {
          const c = counts.get(r.acquisition_id) || { total: 0, merged: 0 };
          c.total++; if (r.merged_store_id) c.merged++;
          counts.set(r.acquisition_id, c);
        }
      }
      return respond(200, { rows: (acqs || []).map((a) => ({ ...a, store_count: counts.get(a.id)?.total || 0, merged_count: counts.get(a.id)?.merged || 0 })) });
    }

    // Existing org hierarchy, for the Region → Area → District dropdowns.
    if (event.httpMethod === "GET" && action === "org-options") {
      const [{ data: regions }, { data: areas }, { data: districts }] = await Promise.all([
        supa.from("regions").select("id, name").order("name"),
        supa.from("areas").select("id, name, region_id").order("name"),
        supa.from("districts").select("id, name, area_id").order("name"),
      ]);
      return respond(200, { regions: regions || [], areas: areas || [], districts: districts || [] });
    }

    if (event.httpMethod === "GET" && action === "get") {
      const id = String(params.id || "").trim();
      if (!id) return respond(400, { error: "id is required" });
      const { data: acq } = await supa.from("acquisitions").select("*").eq("id", id).maybeSingle();
      if (!acq) return respond(404, { error: "Not found." });
      const stores = await acquisitionStores(supa, id);
      // Existing store numbers to flag collisions.
      const nums = [...new Set(stores.map((s) => String(s.store_number)).filter(Boolean))];
      const existing = new Set();
      if (nums.length) {
        const { data: ex } = await supa.from("stores").select("number").in("number", nums);
        for (const e of ex || []) existing.add(String(e.number));
      }
      const rows = stores.map((s) => ({ ...s, issues: validateStore(s, existing), merged: !!s.merged_store_id }));
      const summary = {
        total: rows.length,
        mergeable: rows.filter((r) => !r.merged && r.issues.length === 0).length,
        blocked: rows.filter((r) => !r.merged && r.issues.length > 0).length,
        merged: rows.filter((r) => r.merged).length,
      };
      return respond(200, { acquisition: acq, stores: rows, summary });
    }

    if (event.httpMethod !== "POST") return respond(405, { error: "method not allowed" });
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

    if (action === "create") {
      const name = clean(body.name, 200);
      if (!name) return respond(400, { error: "A name is required." });
      const close_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.close_date || "")) ? body.close_date : null;
      const { data, error } = await supa.from("acquisitions").insert({ name, close_date, notes: clean(body.notes, 2000), created_by: user.id }).select("id").maybeSingle();
      if (error) {
        if (/acquisitions/.test(error.message)) return respond(500, { error: "Run migration 0288 first (acquisitions is missing)." });
        return respond(500, { error: error.message });
      }
      return respond(200, { ok: true, id: data?.id });
    }

    if (action === "update") {
      const id = clean(body.id, 60);
      if (!id) return respond(400, { error: "id is required" });
      const patch = { updated_at: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(body, "name")) { const n = clean(body.name, 200); if (!n) return respond(400, { error: "Name can't be blank." }); patch.name = n; }
      if (Object.prototype.hasOwnProperty.call(body, "close_date")) patch.close_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.close_date || "")) ? body.close_date : null;
      if (Object.prototype.hasOwnProperty.call(body, "notes")) patch.notes = clean(body.notes, 2000);
      const { error } = await supa.from("acquisitions").update(patch).eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    if (action === "delete") {
      const id = clean(body.id, 60);
      const { data: acq } = await supa.from("acquisitions").select("status").eq("id", id).maybeSingle();
      if (!acq) return respond(404, { error: "Not found." });
      if (acq.status === "merged") return respond(400, { error: "This acquisition has been merged — un-merge it first if you really want to remove it." });
      const { error } = await supa.from("acquisitions").delete().eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    if (action === "upload") {
      const id = clean(body.id, 60);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!id) return respond(400, { error: "id is required" });
      const { data: acq } = await supa.from("acquisitions").select("status").eq("id", id).maybeSingle();
      if (!acq) return respond(404, { error: "Not found." });
      if (acq.status === "merged") return respond(400, { error: "This acquisition is already merged." });
      if (rows.length > 3000) return respond(400, { error: "Too many rows in one upload." });
      const ready = rows.map((r) => ({
        acquisition_id: id,
        store_number: clean(r.store_number, 20), name: clean(r.name, 200),
        address: clean(r.address, 300), city: clean(r.city, 120), state: clean(r.state, 40), zip: clean(r.zip, 20), phone: clean(r.phone, 40),
        store_email: clean(r.store_email, 200),
        region_name: clean(r.region_name, 120), area_name: clean(r.area_name, 120), district_name: clean(r.district_name, 120),
        gm_name: clean(r.gm_name, 200), gm_email: clean(r.gm_email, 200), gm_phone: clean(r.gm_phone, 40),
        notes: clean(r.notes, 500),
      })).filter((r) => r.store_number);
      if (!ready.length) return respond(400, { error: "No rows with a store number found." });
      // Replace the staged set for a clean re-upload.
      await supa.from("acquisition_stores").delete().eq("acquisition_id", id);
      const { error } = await supa.from("acquisition_stores").insert(ready);
      if (error) {
        if (/acquisition_stores/.test(error.message)) return respond(500, { error: "Run migration 0288 first (acquisition_stores is missing)." });
        return respond(500, { error: error.message });
      }
      return respond(200, { ok: true, staged: ready.length });
    }

    if (action === "update-store") {
      const storeId = clean(body.store_id, 60);
      if (!storeId) return respond(400, { error: "store_id is required" });
      const patch = {};
      for (const f of ["store_number", "name", "address", "city", "state", "zip", "phone", "store_email", "region_name", "area_name", "district_name", "gm_name", "gm_email", "gm_phone", "notes"]) {
        if (Object.prototype.hasOwnProperty.call(body, f)) patch[f] = clean(body[f], f === "notes" ? 500 : 300);
      }
      if (!Object.keys(patch).length) return respond(400, { error: "nothing to update" });
      const { error } = await supa.from("acquisition_stores").update(patch).eq("id", storeId);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    if (action === "delete-store") {
      const storeId = clean(body.store_id, 60);
      if (!storeId) return respond(400, { error: "store_id is required" });
      const { error } = await supa.from("acquisition_stores").delete().eq("id", storeId);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    // ── The go-live: create active stores + any missing org hierarchy, seed GM. ─
    if (action === "merge") {
      const id = clean(body.id, 60);
      const { data: acq } = await supa.from("acquisitions").select("*").eq("id", id).maybeSingle();
      if (!acq) return respond(404, { error: "Not found." });
      const staged = await acquisitionStores(supa, id);
      const nums = [...new Set(staged.map((s) => String(s.store_number)).filter(Boolean))];
      const existing = new Set();
      if (nums.length) {
        const { data: ex } = await supa.from("stores").select("number").in("number", nums);
        for (const e of ex || []) existing.add(String(e.number));
      }
      const cache = new Map();
      const created = [], skipped = [];
      for (const s of staged) {
        if (s.merged_store_id) { skipped.push({ store_number: s.store_number, reason: "already merged" }); continue; }
        const issues = validateStore(s, existing);
        if (issues.length) { skipped.push({ store_number: s.store_number, reason: issues.join("; ") }); continue; }
        try {
          const regionId = await findOrCreate(supa, "regions", s.region_name, null, null, cache);
          const areaId = await findOrCreate(supa, "areas", s.area_name, "region_id", regionId, cache);
          const districtId = await findOrCreate(supa, "districts", s.district_name, "area_id", areaId, cache);
          const { data: store, error } = await supa.from("stores").insert({
            number: String(s.store_number), name: s.name || `#${s.store_number}`, district_id: districtId,
            address: s.address, city: s.city, state: s.state, zip: s.zip,
            phone: s.phone || null, email: s.store_email || null, is_active: true,
          }).select("id").maybeSingle();
          if (error) { skipped.push({ store_number: s.store_number, reason: error.message }); continue; }
          existing.add(String(s.store_number));
          // GM assignment is handled later (separate roster upload), so merge
          // intentionally does not touch gm_roster here.
          await supa.from("acquisition_stores").update({ merged_store_id: store.id }).eq("id", s.id);
          created.push(String(s.store_number));
        } catch (e) {
          skipped.push({ store_number: s.store_number, reason: e?.message || "merge error" });
        }
      }
      await supa.from("acquisitions").update({ status: "merged", merged_at: new Date().toISOString(), merged_by: user.id, updated_at: new Date().toISOString() }).eq("id", id);
      return respond(200, { ok: true, created: created.length, skipped });
    }

    // ── Geocode the merged stores' addresses so they pin on the Territory Map.
    // Time-budgeted; the client loops until `remaining` hits 0.
    if (action === "geocode") {
      const id = clean(body.id, 60);
      if (!geocodeConfigured()) return respond(500, { error: "Geocoding isn't configured (GOOGLE_GEOCODING_API_KEY)." });
      const staged = await acquisitionStores(supa, id);
      const storeIds = staged.map((s) => s.merged_store_id).filter(Boolean);
      if (!storeIds.length) return respond(200, { ok: true, geocoded: 0, remaining: 0 });
      const { data: stores } = await supa.from("stores").select("id, number, address, city, state").in("id", storeIds).is("latitude", null);
      const todo = stores || [];
      let geocoded = 0;
      const started = Date.now();
      for (const st of todo) {
        if (Date.now() - started > 8000) break; // stay under the function timeout
        const geo = await geocodeStoreOnWrite(st);
        if (geo) { await supa.from("stores").update({ ...geo, updated_at: new Date().toISOString() }).eq("id", st.id); geocoded++; }
      }
      return respond(200, { ok: true, geocoded, remaining: Math.max(0, todo.length - geocoded) });
    }

    // ── Safety net: deactivate the stores a merge created (does not delete). ────
    if (action === "unmerge") {
      const id = clean(body.id, 60);
      const staged = await acquisitionStores(supa, id);
      const storeIds = staged.map((s) => s.merged_store_id).filter(Boolean);
      let deactivated = 0;
      if (storeIds.length) {
        const { error } = await supa.from("stores").update({ is_active: false, updated_at: new Date().toISOString() }).in("id", storeIds);
        if (error) return respond(500, { error: error.message });
        deactivated = storeIds.length;
        await supa.from("acquisition_stores").update({ merged_store_id: null }).eq("acquisition_id", id);
      }
      await supa.from("acquisitions").update({ status: "draft", merged_at: null, merged_by: null, updated_at: new Date().toISOString() }).eq("id", id);
      return respond(200, { ok: true, deactivated });
    }

    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("[acquisitions]", e?.message || e);
    return respond(500, { error: e?.message || "server error" });
  }
};
