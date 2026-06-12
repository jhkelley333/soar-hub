// SOAR Site Audits (Audit Pro) — backend.
//
// A GM (or above) walks a store and captures issues (photo + note + severity +
// due + optional required proof). Anyone in scope tracks each issue to
// completion; the required-proof loop is enforced HERE, server-side, so an
// issue can never close without its photo/note even via the API.
//
// Service-role gatekeeper: this function uses the service key and scopes every
// read/write to the caller's stores. One audit = one dated walk.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "site-audit-photos";

// GM and above may create audits, capture issues, set proof, resolve, share.
const CAPTURE_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
const ORG_WIDE = new Set(["vp", "coo", "admin"]);
const AREAS = new Set(["Exterior", "Entrance", "Sales Floor", "Restroom", "Stockroom", "Restaurant", "Kitchen", "Parking Lot", "General", "Other"]);
const SEVERITIES = new Set(["high", "medium", "low"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("site-audit env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}
function sanitize(v, max) {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}
function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "Someone";
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Stores the caller can see (org-wide roles see all; others by user_scopes).
async function storesForUser(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (ORG_WIDE.has(role)) {
    const { data } = await supa.from("stores").select("id, number, name, district_id").eq("is_active", true).limit(2000);
    return { all: true, ids: new Set((data || []).map((s) => s.id)), rows: data || [] };
  }
  const { data: scopes } = await supa.from("user_scopes").select("scope_type, scope_id").eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, ids: new Set(), rows: [] };
  const directStoreIds = scopes.filter((s) => s.scope_type === "store").map((s) => s.scope_id);
  const districtIds = scopes.filter((s) => s.scope_type === "district").map((s) => s.scope_id);
  const areaIds = scopes.filter((s) => s.scope_type === "area").map((s) => s.scope_id);
  const regionIds = scopes.filter((s) => s.scope_type === "region").map((s) => s.scope_id);
  if (regionIds.length) {
    const { data } = await supa.from("areas").select("id").in("region_id", regionIds);
    for (const a of data || []) areaIds.push(a.id);
  }
  if (areaIds.length) {
    const { data } = await supa.from("districts").select("id").in("area_id", areaIds);
    for (const d of data || []) districtIds.push(d.id);
  }
  const storeIds = new Set(directStoreIds);
  if (districtIds.length) {
    const { data } = await supa.from("stores").select("id").in("district_id", districtIds);
    for (const s of data || []) storeIds.add(s.id);
  }
  if (storeIds.size === 0) return { all: false, ids: new Set(), rows: [] };
  const { data: rows } = await supa.from("stores").select("id, number, name, district_id").in("id", Array.from(storeIds));
  return { all: false, ids: storeIds, rows: rows || [] };
}

// Decode a base64 (or data-URL) image and upload it; returns the storage path.
async function uploadImage(supa, photo, prefix) {
  if (!photo?.data) return null;
  let b64 = String(photo.data);
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:") && comma > -1) b64 = b64.slice(comma + 1);
  const buf = Buffer.from(b64, "base64");
  if (!buf.length || buf.length > 10 * 1024 * 1024) return null; // 10 MB cap
  const type = sanitize(photo.type, 40) || "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const path = `${prefix}/${globalThis.crypto.randomUUID()}.${ext}`;
  const { error } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
async function signed(supa, path) {
  if (!path) return null;
  const { data } = await supa.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

async function issueCard(supa, i) {
  let completion = i.completion || null;
  if (completion?.photo_url) completion = { ...completion, photo_url: await signed(supa, completion.photo_url) };
  return {
    id: i.id, audit_id: i.audit_id, title: i.title, area: i.area, severity: i.severity,
    comment: i.comment, photo_url: await signed(supa, i.photo_url), due: i.due,
    proof_required: i.proof_required || [], completed: i.completed, completion,
    created_at: i.created_at,
  };
}
function auditStats(issues) {
  const total = issues.length;
  const done = issues.filter((i) => i.completed).length;
  const high = issues.filter((i) => i.severity === "high" && !i.completed).length;
  return { total, done, open: total - done, high, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Look up an audit + verify the caller can see its store. Returns { audit } or { error }.
async function loadAudit(supa, user, auditId) {
  const { data: audit } = await supa.from("site_audits").select("*").eq("id", auditId).maybeSingle();
  if (!audit) return { error: "Audit not found.", status: 404 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(audit.store_id)) return { error: "That store is outside your scope.", status: 403 };
  return { audit };
}

// ----------------------------------------------------------------------------
async function listAudits(supa, user) {
  const scope = await storesForUser(supa, user);
  let q = supa.from("site_audits").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (!scope.all) {
    if (scope.ids.size === 0) return { audits: [], can_write: CAPTURE_ROLES.has(String(user.role)) };
    q = q.in("store_id", Array.from(scope.ids));
  }
  const { data: audits, error } = await q;
  if (error) return { error: error.message, status: 500 };
  const ids = (audits || []).map((a) => a.id);
  const { data: allIssues } = ids.length
    ? await supa.from("site_audit_issues").select("*").in("audit_id", ids).order("created_at", { ascending: true })
    : { data: [] };
  const byAudit = new Map();
  for (const i of allIssues || []) {
    if (!byAudit.has(i.audit_id)) byAudit.set(i.audit_id, []);
    byAudit.get(i.audit_id).push(i);
  }
  const storeName = new Map(scope.rows.map((s) => [s.id, s.name]));
  const out = [];
  for (const a of audits || []) {
    const issues = byAudit.get(a.id) || [];
    out.push({
      id: a.id, store_id: a.store_id, store_number: a.store_number, store_name: storeName.get(a.store_id) || null,
      created_by_name: a.created_by_name, status: a.status, note: a.note, date: a.date, created_at: a.created_at,
      stats: auditStats(issues),
      issues: await Promise.all(issues.map((i) => issueCard(supa, i))),
    });
  }
  return { audits: out, can_write: CAPTURE_ROLES.has(String(user.role)) };
}

async function createAudit(supa, user, body) {
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't start an audit.", status: 403 };
  const storeId = sanitize(body?.store_id, 64);
  if (!storeId) return { error: "Pick a store.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(storeId)) return { error: "That store is outside your scope.", status: 403 };
  const store = scope.rows.find((s) => s.id === storeId);
  const { data, error } = await supa.from("site_audits").insert({
    store_id: storeId, store_number: store ? String(store.number) : "",
    created_by: user.id, created_by_name: displayName(user), note: sanitize(body?.note, 500) || null,
  }).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, audit_id: data.id };
}

async function captureIssue(supa, user, body) {
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't capture issues.", status: 403 };
  const auditId = sanitize(body?.audit_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  const title = sanitize(body?.title, 200);
  if (!title) return { error: "Add a short title for the issue.", status: 400 };
  const area = AREAS.has(body?.area) ? body.area : "General";
  const severity = SEVERITIES.has(body?.severity) ? body.severity : "medium";
  const proofRequired = Array.isArray(body?.proof_required)
    ? body.proof_required.filter((p) => p === "photo" || p === "note")
    : [];
  const due = /^\d{4}-\d{2}-\d{2}$/.test(body?.due || "") ? body.due : null;
  let photoPath = null;
  try { photoPath = await uploadImage(supa, body?.photo, auditId); }
  catch (e) { return { error: `Photo upload failed: ${e.message}`, status: 500 }; }
  const { data, error } = await supa.from("site_audit_issues").insert({
    audit_id: auditId, title, area, severity, comment: sanitize(body?.comment, 2000) || null,
    photo_url: photoPath, due, proof_required: proofRequired, created_by: user.id,
  }).select("*").single();
  if (error) return { error: error.message, status: 500 };
  await supa.from("site_audits").update({ updated_at: new Date().toISOString() }).eq("id", auditId);
  return { ok: true, issue: await issueCard(supa, data) };
}

async function updateIssue(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const issueId = sanitize(body?.issue_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't edit issues.", status: 403 };
  const patch = { updated_at: new Date().toISOString() };
  if (typeof body?.title === "string") patch.title = sanitize(body.title, 200) || undefined;
  if (AREAS.has(body?.area)) patch.area = body.area;
  if (SEVERITIES.has(body?.severity)) patch.severity = body.severity;
  if (typeof body?.comment === "string") patch.comment = sanitize(body.comment, 2000) || null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(body?.due || "")) patch.due = body.due;
  const { error } = await supa.from("site_audit_issues").update(patch).eq("id", issueId).eq("audit_id", auditId);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// The proof loop — enforced here. An issue with proof_required can't close
// unless the matching items are supplied.
async function resolveIssue(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const issueId = sanitize(body?.issue_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't resolve issues.", status: 403 };
  const { data: issue } = await supa.from("site_audit_issues").select("*").eq("id", issueId).eq("audit_id", auditId).maybeSingle();
  if (!issue) return { error: "Issue not found.", status: 404 };

  if (body?.reopen === true) {
    const { error } = await supa.from("site_audit_issues")
      .update({ completed: false, updated_at: new Date().toISOString() }).eq("id", issueId);
    if (error) return { error: error.message, status: 500 };
    return { ok: true };
  }

  const need = issue.proof_required || [];
  const note = sanitize(body?.completion?.note, 2000);
  let photoPath = null;
  try { photoPath = await uploadImage(supa, body?.completion?.photo, `${auditId}/proof`); }
  catch (e) { return { error: `Proof photo upload failed: ${e.message}`, status: 500 }; }

  if (need.includes("note") && note.length < 1) {
    return { error: "A note is required to close this issue.", status: 422 };
  }
  if (need.includes("photo") && !photoPath) {
    return { error: "A photo is required to close this issue.", status: 422 };
  }

  const completion = {
    by: user.id, by_name: displayName(user), at: new Date().toISOString(),
    note: note || null, photo_url: photoPath,
  };
  const { error } = await supa.from("site_audit_issues")
    .update({ completed: true, completion, updated_at: new Date().toISOString() }).eq("id", issueId);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function deleteIssue(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't delete issues.", status: 403 };
  const { error } = await supa.from("site_audit_issues").delete().eq("id", sanitize(body?.issue_id, 64)).eq("audit_id", auditId);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function deleteAudit(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  // Only the auditor or a DO+ can delete an audit.
  const isLeader = ORG_WIDE.has(String(user.role)) || ["do", "sdo", "rvp"].includes(String(user.role));
  if (r.audit.created_by !== user.id && !isLeader) return { error: "Only the auditor or a DO+ can delete this audit.", status: 403 };
  const { error } = await supa.from("site_audits").delete().eq("id", auditId);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let user;
  try { user = await getSessionUser(event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listAudits(supa, user));
      if (action === "stores") return unwrap(await listStores(supa, user));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "create-audit") return unwrap(await createAudit(supa, user, body));
    if (action === "capture-issue") return unwrap(await captureIssue(supa, user, body));
    if (action === "update-issue") return unwrap(await updateIssue(supa, user, body));
    if (action === "resolve-issue") return unwrap(await resolveIssue(supa, user, body));
    if (action === "delete-issue") return unwrap(await deleteIssue(supa, user, body));
    if (action === "delete-audit") return unwrap(await deleteAudit(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};

// Stores the caller can start an audit at (for the New Audit picker).
async function listStores(supa, user) {
  const scope = await storesForUser(supa, user);
  const rows = (scope.rows || []).slice().sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  return { stores: rows.map((s) => ({ id: s.id, number: String(s.number), name: s.name })), can_write: CAPTURE_ROLES.has(String(user.role)) };
}
