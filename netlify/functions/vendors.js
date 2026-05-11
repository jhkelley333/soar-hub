// netlify/functions/vendors.js
//
// First-class vendors API. Phase 0 lives behind Contacts (a contact
// with contact_type='vendor' and vendor_id set bridges the two). Work
// Orders rebuild against this same vendors table is a later track.
//
// Actions:
//
//   GET  ?action=list                 — vendors visible to caller
//   GET  ?action=get&id=...           — single vendor
//   GET  ?action=docs&vendor_id=...   — list docs for a vendor
//   GET  ?action=doc-signed-url&id=...— short-lived signed URL to view a doc
//
//   POST ?action=create               — create vendor
//   POST ?action=update               — partial update
//   POST ?action=delete               — delete vendor (cascades docs)
//   POST ?action=doc-upload-url       — get a signed PUT URL for a new doc
//                                        (caller uploads to storage, then
//                                        POSTs back to ?action=register-doc)
//   POST ?action=register-doc         — write the vendor_docs row after a
//                                        successful upload
//   POST ?action=delete-doc           — delete a vendor doc (storage + row)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ORG_WIDE = new Set(["payroll", "admin", "vp", "coo"]);
const LEADERSHIP_REACH_SCOPES = new Set(["district", "area", "region", "global"]);

const TIERS = new Set(["company", "regional", "area", "district", "store"]);
const DOC_TYPES = new Set(["w9", "insurance", "nda", "certification", "other"]);
const STORAGE_BUCKET = "vendor-docs";
const SIGNED_URL_EXPIRY_SECONDS = 600; // 10 minutes for view; uploads use the same window

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("vendors env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
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
    .select("id, email, full_name, role, primary_store_id, is_active")
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
// Authz helpers — mirror RLS on vendors (0030)
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
    .from("user_scopes").select("scope_type").eq("user_id", user.id);
  return (data ?? []).some((s) => LEADERSHIP_REACH_SCOPES.has(s.scope_type));
}

async function callerCanWriteVendor(supa, user, v) {
  const { tier, region_id, area_id, district_id, store_id } = v;
  if (ORG_WIDE.has(user.role)) return true;
  if (tier === "company") return false;
  if (tier === "regional") {
    if (!region_id) return false;
    if (!(await callerHasLeadershipReach(supa, user))) return false;
    return (await callerVisibleRegionIds(supa, user)).has(region_id);
  }
  if (tier === "area") {
    if (!area_id) return false;
    if (!(await callerHasLeadershipReach(supa, user))) return false;
    return (await callerVisibleAreaIds(supa, user)).has(area_id);
  }
  if (tier === "district") {
    if (!district_id) return false;
    if (!(await callerHasLeadershipReach(supa, user))) return false;
    return (await callerVisibleDistrictIds(supa, user)).has(district_id);
  }
  if (tier === "store") {
    if (!store_id) return false;
    return (await callerVisibleStoreIds(supa, user)).has(store_id);
  }
  return false;
}

async function callerCanReadVendor(supa, user, v) {
  const { tier, region_id, area_id, district_id, store_id } = v;
  if (ORG_WIDE.has(user.role)) return true;
  if (tier === "company") return true;
  if (tier === "regional") {
    return (await callerVisibleRegionIds(supa, user)).has(region_id);
  }
  if (tier === "area") {
    return (await callerVisibleAreaIds(supa, user)).has(area_id);
  }
  if (tier === "district") {
    return (await callerVisibleDistrictIds(supa, user)).has(district_id);
  }
  if (tier === "store") {
    return (await callerVisibleStoreIds(supa, user)).has(store_id);
  }
  return false;
}

// ----------------------------------------------------------------------------
// Input normalization
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

function buildVendorPayload(body, { skipScope = false } = {}) {
  const out = {};
  if (body?.company_name !== undefined) {
    const v = normString(body.company_name, 200);
    if (!v) return { error: "company_name is required." };
    out.company_name = v;
  }
  for (const f of ["contact_name", "phone", "website", "trade_category",
                   "address", "city", "state", "zip", "notes"]) {
    if (body?.[f] !== undefined) out[f] = normString(body[f], 500);
  }
  if (body?.email !== undefined) out.email = normEmail(body.email);

  if (body?.preferred !== undefined) {
    if (typeof body.preferred !== "boolean") return { error: "preferred must be boolean." };
    out.preferred = body.preferred;
  }
  if (body?.hourly_rate !== undefined) {
    if (body.hourly_rate === null) out.hourly_rate = null;
    else {
      const n = Number(body.hourly_rate);
      if (!Number.isFinite(n) || n < 0) return { error: "hourly_rate must be a non-negative number." };
      out.hourly_rate = n;
    }
  }
  if (body?.response_time_hours !== undefined) {
    if (body.response_time_hours === null) out.response_time_hours = null;
    else {
      const n = parseInt(body.response_time_hours, 10);
      if (!Number.isFinite(n) || n < 0) return { error: "response_time_hours must be a non-negative integer." };
      out.response_time_hours = n;
    }
  }
  if (body?.w9_on_file !== undefined) {
    if (typeof body.w9_on_file !== "boolean") return { error: "w9_on_file must be boolean." };
    out.w9_on_file = body.w9_on_file;
  }
  if (body?.insurance_expiry !== undefined) {
    if (body.insurance_expiry === null) out.insurance_expiry = null;
    else if (typeof body.insurance_expiry === "string"
             && /^\d{4}-\d{2}-\d{2}$/.test(body.insurance_expiry)) {
      out.insurance_expiry = body.insurance_expiry;
    } else {
      return { error: "insurance_expiry must be YYYY-MM-DD or null." };
    }
  }

  if (!skipScope) {
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
    out.tier = tier;
    out.region_id = region_id;
    out.area_id = area_id;
    out.district_id = district_id;
    out.store_id = store_id;
  }

  return out;
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

async function listVendors(supa, _user) {
  const { data, error } = await supa
    .from("vendors").select("*").order("company_name");
  if (error) return { error: error.message, status: 500 };
  return { vendors: data ?? [] };
}

async function getVendor(supa, _user, query) {
  const id = String(query?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };
  const { data, error } = await supa.from("vendors").select("*").eq("id", id).maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found.", status: 404 };
  return { vendor: data };
}

async function createVendor(supa, user, body) {
  const payload = buildVendorPayload(body);
  if (payload.error) return { error: payload.error, status: 400 };
  if (!payload.company_name) return { error: "company_name is required.", status: 400 };

  const allowed = await callerCanWriteVendor(supa, user, payload);
  if (!allowed) return { error: "forbidden", status: 403 };

  payload.created_by = user.id;
  const { data, error } = await supa.from("vendors").insert(payload).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { vendor: data };
}

async function updateVendor(supa, user, body) {
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };

  const { data: existing } = await supa.from("vendors").select("*").eq("id", id).maybeSingle();
  if (!existing) return { error: "Not found.", status: 404 };

  const allowed = await callerCanWriteVendor(supa, user, existing);
  if (!allowed) return { error: "forbidden", status: 403 };

  if (body?.tier !== undefined && body.tier !== existing.tier && !ORG_WIDE.has(user.role)) {
    return { error: "Only admins can change a vendor's tier.", status: 403 };
  }

  const payload = buildVendorPayload(body, { skipScope: body?.tier === undefined });
  if (payload.error) return { error: payload.error, status: 400 };
  delete payload.created_by;
  if (Object.keys(payload).length === 0) {
    return { error: "no updatable fields provided.", status: 400 };
  }

  const { data, error } = await supa
    .from("vendors").update(payload).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { vendor: data };
}

async function deleteVendor(supa, user, body) {
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };
  const { data: existing } = await supa.from("vendors").select("*").eq("id", id).maybeSingle();
  if (!existing) return { error: "Not found.", status: 404 };
  const allowed = await callerCanWriteVendor(supa, user, existing);
  if (!allowed) return { error: "forbidden", status: 403 };
  const { error } = await supa.from("vendors").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Vendor docs
// ----------------------------------------------------------------------------

async function listVendorDocs(supa, user, query) {
  const vendorId = String(query?.vendor_id || "").trim();
  if (!vendorId) return { error: "vendor_id required.", status: 400 };
  const { data: vendor } = await supa.from("vendors").select("*").eq("id", vendorId).maybeSingle();
  if (!vendor) return { error: "Vendor not found.", status: 404 };
  if (!(await callerCanReadVendor(supa, user, vendor))) {
    return { error: "forbidden", status: 403 };
  }
  const { data, error } = await supa
    .from("vendor_docs").select("*").eq("vendor_id", vendorId).order("uploaded_at", { ascending: false });
  if (error) return { error: error.message, status: 500 };
  return { docs: data ?? [] };
}

async function docSignedUrl(supa, user, query) {
  const docId = String(query?.id || "").trim();
  if (!docId) return { error: "id required.", status: 400 };
  const { data: doc } = await supa.from("vendor_docs").select("*").eq("id", docId).maybeSingle();
  if (!doc) return { error: "Not found.", status: 404 };
  const { data: vendor } = await supa.from("vendors").select("*").eq("id", doc.vendor_id).maybeSingle();
  if (!vendor) return { error: "Vendor not found.", status: 404 };
  if (!(await callerCanReadVendor(supa, user, vendor))) {
    return { error: "forbidden", status: 403 };
  }
  const { data, error } = await supa.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_EXPIRY_SECONDS);
  if (error) return { error: error.message, status: 500 };
  return { url: data.signedUrl, expires_in: SIGNED_URL_EXPIRY_SECONDS };
}

async function docUploadUrl(supa, user, body) {
  const vendorId = String(body?.vendor_id || "").trim();
  const docType = String(body?.doc_type || "").trim();
  const filename = normString(body?.filename, 200);
  if (!vendorId) return { error: "vendor_id required.", status: 400 };
  if (!DOC_TYPES.has(docType)) return { error: "doc_type invalid.", status: 400 };
  if (!filename) return { error: "filename required.", status: 400 };

  const { data: vendor } = await supa.from("vendors").select("*").eq("id", vendorId).maybeSingle();
  if (!vendor) return { error: "Vendor not found.", status: 404 };
  if (!(await callerCanWriteVendor(supa, user, vendor))) {
    return { error: "forbidden", status: 403 };
  }

  // Path convention: {vendor_id}/{timestamp}-{filename}
  // The vendor_id-as-prefix is what the storage RLS policy in 0030
  // uses (split_part(name, '/', 1)).
  const ts = Date.now();
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${vendorId}/${ts}-${safe}`;

  const { data, error } = await supa.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(path);
  if (error) return { error: error.message, status: 500 };
  return {
    upload_url: data.signedUrl,
    path,
    token: data.token, // for the client to use with the upload SDK
  };
}

async function registerDoc(supa, user, body) {
  const vendorId = String(body?.vendor_id || "").trim();
  const docType = String(body?.doc_type || "").trim();
  const storagePath = String(body?.storage_path || "").trim();
  const expiresAt = body?.expires_at ? normString(body.expires_at, 20) : null;
  if (!vendorId) return { error: "vendor_id required.", status: 400 };
  if (!DOC_TYPES.has(docType)) return { error: "doc_type invalid.", status: 400 };
  if (!storagePath) return { error: "storage_path required.", status: 400 };
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    return { error: "expires_at must be YYYY-MM-DD.", status: 400 };
  }

  const { data: vendor } = await supa.from("vendors").select("*").eq("id", vendorId).maybeSingle();
  if (!vendor) return { error: "Vendor not found.", status: 404 };
  if (!(await callerCanWriteVendor(supa, user, vendor))) {
    return { error: "forbidden", status: 403 };
  }

  const { data, error } = await supa
    .from("vendor_docs")
    .insert({
      vendor_id: vendorId,
      doc_type: docType,
      storage_path: storagePath,
      uploaded_by: user.id,
      expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (error) return { error: error.message, status: 500 };

  // Custom audit action.
  await supa.from("vendor_audit_log").insert({
    vendor_id: vendorId,
    changed_by: user.id,
    action: "doc_upload",
    changes: { doc_id: data.id, doc_type: docType, storage_path: storagePath },
  });

  return { doc: data };
}

async function deleteDoc(supa, user, body) {
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id required.", status: 400 };
  const { data: doc } = await supa.from("vendor_docs").select("*").eq("id", id).maybeSingle();
  if (!doc) return { error: "Not found.", status: 404 };
  const { data: vendor } = await supa.from("vendors").select("*").eq("id", doc.vendor_id).maybeSingle();
  if (!vendor) return { error: "Vendor not found.", status: 404 };
  if (!(await callerCanWriteVendor(supa, user, vendor))) {
    return { error: "forbidden", status: 403 };
  }

  await supa.storage.from(STORAGE_BUCKET).remove([doc.storage_path]);
  const { error } = await supa.from("vendor_docs").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await supa.from("vendor_audit_log").insert({
    vendor_id: doc.vendor_id,
    changed_by: user.id,
    action: "doc_delete",
    changes: { doc_id: id, doc_type: doc.doc_type, storage_path: doc.storage_path },
  });

  return { ok: true };
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
      if (action === "list")              return unwrap(await listVendors(supa, user));
      if (action === "get")               return unwrap(await getVendor(supa, user, params));
      if (action === "docs")              return unwrap(await listVendorDocs(supa, user, params));
      if (action === "doc-signed-url")    return unwrap(await docSignedUrl(supa, user, params));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return respond(400, { error: "invalid JSON body" });
      }
      if (action === "create")         return unwrap(await createVendor(supa, user, body));
      if (action === "update")         return unwrap(await updateVendor(supa, user, body));
      if (action === "delete")         return unwrap(await deleteVendor(supa, user, body));
      if (action === "doc-upload-url") return unwrap(await docUploadUrl(supa, user, body));
      if (action === "register-doc")   return unwrap(await registerDoc(supa, user, body));
      if (action === "delete-doc")     return unwrap(await deleteDoc(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
