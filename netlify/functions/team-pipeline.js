// Team Pipeline (Talent Planning) — backend.
//
// Service-role gatekeeper. Every read/write is scoped to the caller's stores.
// Team members are the store roster (Carhop → GM); most are not app accounts.
// Talent-planning data (flight risk, succession, reqs) is DO-and-above.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ORG_WIDE = new Set(["vp", "coo", "admin"]);
const VIEW_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]); // talent data audience
// SOAR auth role → ladder role key
const ROLE_MAP = {
  gm: "gm", first_assistant_manager: "fam", associate_manager: "assoc",
  crew_leader: "lead", shift_manager: "shift", crew_member: "crew", carhop: "carhop",
};
const ROLE_KEYS = new Set(["carhop", "crew", "lead", "shift", "assoc", "fam", "gm"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("team-pipeline env vars not configured");
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

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles").select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Stores the caller can see (org-wide roles see all; others by user_scopes).
async function storesForUser(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (ORG_WIDE.has(role)) {
    const { data } = await supa.from("stores").select("id").eq("is_active", true).limit(5000);
    return { all: true, ids: new Set((data || []).map((s) => s.id)) };
  }
  const { data: scopes } = await supa.from("user_scopes").select("scope_type, scope_id").eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, ids: new Set() };
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
  return { all: false, ids: storeIds };
}

const emptyRisk = () => ({ immediate: 0, medium: 0, low: 0, na: 0 });

// Per-store talent aggregates, keyed by store id. The client overlays these
// onto its (already RLS-scoped) org tree, so we don't re-ship the org here.
async function rollup(supa, user) {
  const scope = await storesForUser(supa, user);
  const ids = scope.all ? null : Array.from(scope.ids);
  if (ids && ids.length === 0) return { stores: {}, can_write: VIEW_ROLES.has(String(user.role)) };

  let mq = supa.from("tp_team_members").select("store_id, role, flight_risk");
  if (ids) mq = mq.in("store_id", ids);
  const { data: members } = await mq;

  let rq = supa.from("tp_requisitions").select("store_id, status");
  if (ids) rq = rq.in("store_id", ids);
  const { data: reqs } = await rq;

  const stores = {};
  const slot = (id) => (stores[id] ||= { risk: emptyRisk(), roster: 0, open_reqs: 0, gm_risk: null });
  for (const m of members || []) {
    const s = slot(m.store_id);
    s.roster++;
    s.risk[m.flight_risk] = (s.risk[m.flight_risk] || 0) + 1;
    if (m.role === "gm") s.gm_risk = m.flight_risk;
  }
  for (const r of reqs || []) if (r.status !== "filled") slot(r.store_id).open_reqs++;

  return { stores, can_write: VIEW_ROLES.has(String(user.role)) };
}

async function storeRoster(supa, user, storeId) {
  if (!storeId) return { error: "Missing store.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(storeId)) return { error: "That store is outside your scope.", status: 403 };
  const { data: roster } = await supa.from("tp_team_members").select("*").eq("store_id", storeId).order("created_at", { ascending: true });
  const { data: reqs } = await supa.from("tp_requisitions").select("*").eq("store_id", storeId).neq("status", "filled").order("created_at", { ascending: false });
  return { roster: roster || [], reqs: reqs || [], can_write: VIEW_ROLES.has(String(user.role)) };
}

// Every GM (role=gm) in the caller's scope — the GM bench. The client keys
// these by store_id against its org tree to render the district bench.
async function gms(supa, user) {
  const scope = await storesForUser(supa, user);
  const ids = scope.all ? null : Array.from(scope.ids);
  if (ids && ids.length === 0) return { gms: [] };
  let q = supa.from("tp_team_members").select("*").eq("role", "gm");
  if (ids) q = q.in("store_id", ids);
  const { data } = await q;
  return { gms: data || [] };
}

// Admin-only: bootstrap the roster from existing SOAR profiles that have a
// home store + a store-floor/GM role. Idempotent (skips already-linked
// profiles). A stop-gap so the views have real data before the ATS import.
async function seedFromProfiles(supa, user) {
  if (String(user.role) !== "admin") return { error: "Admin only.", status: 403 };
  const { data: profs } = await supa
    .from("profiles").select("id, full_name, preferred_name, email, role, primary_store_id")
    .not("primary_store_id", "is", null);
  let created = 0;
  for (const p of profs || []) {
    const rk = ROLE_MAP[String(p.role)];
    if (!rk) continue;
    const { data: exists } = await supa.from("tp_team_members").select("id").eq("profile_id", p.id).maybeSingle();
    if (exists) continue;
    const { error } = await supa.from("tp_team_members").insert({
      store_id: p.primary_store_id, profile_id: p.id, role: rk,
      full_name: p.preferred_name || p.full_name || p.email || "Team member", email: p.email,
    });
    if (!error) created++;
  }
  return { ok: true, created };
}

// Commit a staffing plan: apply promotions (role changes) and open one
// requisition per queued hire. Scoped to the caller's store.
function reqRef() { return "REQ-" + Math.floor(1000 + Math.random() * 9000); }
async function commitPlan(supa, user, body) {
  const storeId = body?.store_id;
  if (!storeId) return { error: "Missing store.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(storeId)) return { error: "That store is outside your scope.", status: 403 };
  const name = user.preferred_name || user.full_name || user.email || "Someone";

  let promoted = 0, reqsOpened = 0;
  const promotions = Array.isArray(body?.promotions) ? body.promotions : [];
  for (const p of promotions) {
    if (!p?.member_id || !p?.to_role || !ROLE_KEYS.has(String(p.to_role))) continue;
    const { error } = await supa.from("tp_team_members")
      .update({ role: String(p.to_role) }).eq("id", p.member_id).eq("store_id", storeId);
    if (!error) promoted++;
  }
  const hires = body?.hires && typeof body.hires === "object" ? body.hires : {};
  for (const [role, count] of Object.entries(hires)) {
    if (!ROLE_KEYS.has(role)) continue;
    const n = Math.max(0, Math.min(20, parseInt(count, 10) || 0));
    for (let i = 0; i < n; i++) {
      const { error } = await supa.from("tp_requisitions").insert({
        store_id: storeId, role, ref: reqRef(), reason: "Staffing gap vs. sales tier",
        status: "sourcing", opened_by: name, opened_by_id: user.id,
      });
      if (!error) reqsOpened++;
    }
  }
  return { ok: true, promoted, reqs_opened: reqsOpened };
}

// Resolve a roster member and confirm it falls inside the caller's scope.
async function memberInScope(supa, scope, memberId) {
  const { data: m } = await supa.from("tp_team_members").select("id, store_id").eq("id", memberId).maybeSingle();
  if (!m) return null;
  if (!scope.all && !scope.ids.has(m.store_id)) return null;
  return m;
}
function clampRating(v) {
  if (v == null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : Math.max(1, Math.min(5, n));
}
const RISK_VALS = new Set(["na", "low", "medium", "immediate"]);
const ASPIRATION_VALS = new Set(["current", "next", "looking"]);
const STATUS_VALS = new Set(["active", "loa"]);

// Patch a roster member's talent overlay (risk, aspiration, ratings, backfill,
// status). Only known fields with valid values are written.
async function updateMember(supa, user, body) {
  const id = body?.member_id;
  if (!id) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, id))) return { error: "That team member is outside your scope.", status: 403 };
  const p = body?.patch && typeof body.patch === "object" ? body.patch : {};
  const patch = {};
  if ("flight_risk" in p && RISK_VALS.has(p.flight_risk)) patch.flight_risk = p.flight_risk;
  if ("aspiration" in p && ASPIRATION_VALS.has(p.aspiration)) patch.aspiration = p.aspiration;
  if ("status" in p && STATUS_VALS.has(p.status)) patch.status = p.status;
  if ("perf" in p) patch.perf = clampRating(p.perf);
  if ("potential" in p) patch.potential = clampRating(p.potential);
  if ("backfill" in p) patch.backfill = p.backfill == null ? null : String(p.backfill).slice(0, 300);
  if ("risk_reasons" in p && Array.isArray(p.risk_reasons)) {
    patch.risk_reasons = p.risk_reasons.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 12);
  }
  if (Object.keys(patch).length === 0) return { error: "Nothing to update.", status: 400 };
  const { data, error } = await supa.from("tp_team_members").update(patch).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, member: data };
}

async function listNotes(supa, user, memberId) {
  if (!memberId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, memberId))) return { error: "That team member is outside your scope.", status: 403 };
  const { data } = await supa.from("tp_notes").select("*").eq("team_member_id", memberId).order("created_at", { ascending: false });
  return { notes: data || [] };
}

// Append a note to the member's thread; also mirror it onto comment/comment_by
// so the GM bench "latest comment" column stays current.
async function addNote(supa, user, body) {
  const id = body?.member_id;
  const text = String(body?.body || "").trim();
  if (!id) return { error: "Missing team member.", status: 400 };
  if (!text) return { error: "A note needs some text.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, id))) return { error: "That team member is outside your scope.", status: 403 };
  const author = user.preferred_name || user.full_name || user.email || "Someone";
  const clipped = text.slice(0, 2000);
  const { data, error } = await supa.from("tp_notes")
    .insert({ team_member_id: id, body: clipped, author, author_id: user.id }).select("*").single();
  if (error) return { error: error.message, status: 500 };
  await supa.from("tp_team_members").update({ comment: clipped, comment_by: author }).eq("id", id);
  return { ok: true, note: data };
}

const REQ_STATUS = new Set(["sourcing", "interviewing", "offer", "filled"]);
async function updateReq(supa, user, body) {
  const id = body?.req_id;
  if (!id) return { error: "Missing requisition.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: r } = await supa.from("tp_requisitions").select("id, store_id").eq("id", id).maybeSingle();
  if (!r || (!scope.all && !scope.ids.has(r.store_id))) return { error: "That requisition is outside your scope.", status: 403 };
  const patch = {};
  if ("status" in (body || {}) && REQ_STATUS.has(body.status)) {
    patch.status = body.status;
    patch.filled_at = body.status === "filled" ? new Date().toISOString() : null;
  }
  if ("candidates" in (body || {})) {
    const n = parseInt(body.candidates, 10);
    if (!Number.isNaN(n)) patch.candidates = Math.max(0, Math.min(99, n));
  }
  if (Object.keys(patch).length === 0) return { error: "Nothing to update.", status: 400 };
  const { data, error } = await supa.from("tp_requisitions").update(patch).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, req: data };
}

// Corrective-action documents (progressive discipline) on a roster member.
const CA_LEVELS = new Set(["verbal", "written", "final", "pip"]);
const CA_STATUS = new Set(["active", "acknowledged", "closed"]);

async function listCorrectiveActions(supa, user, memberId) {
  if (!memberId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, memberId))) return { error: "That team member is outside your scope.", status: 403 };
  const { data } = await supa.from("tp_corrective_actions").select("*").eq("team_member_id", memberId).order("created_at", { ascending: false });
  return { actions: data || [] };
}

async function addCorrectiveAction(supa, user, body) {
  const id = body?.member_id;
  const level = String(body?.level || "");
  const summary = String(body?.summary || "").trim();
  if (!id) return { error: "Missing team member.", status: 400 };
  if (!CA_LEVELS.has(level)) return { error: "Pick a corrective-action level.", status: 400 };
  if (!summary) return { error: "Describe the incident.", status: 400 };
  const scope = await storesForUser(supa, user);
  const m = await memberInScope(supa, scope, id);
  if (!m) return { error: "That team member is outside your scope.", status: 403 };
  const clip = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));
  const row = {
    team_member_id: id, store_id: m.store_id, level,
    category: clip(body?.category, 40),
    incident_date: body?.incident_date || null,
    summary: summary.slice(0, 4000),
    expectations: clip(body?.expectations, 4000),
    consequence: clip(body?.consequence, 4000),
    issued_by: user.preferred_name || user.full_name || user.email || "Someone",
    issued_by_id: user.id,
  };
  const { data, error } = await supa.from("tp_corrective_actions").insert(row).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, action: data };
}

async function setCorrectiveActionStatus(supa, user, body) {
  const id = body?.action_id;
  const status = String(body?.status || "");
  if (!id || !CA_STATUS.has(status)) return { error: "Missing or invalid status.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: ca } = await supa.from("tp_corrective_actions").select("id, store_id").eq("id", id).maybeSingle();
  if (!ca || (!scope.all && !scope.ids.has(ca.store_id))) return { error: "That document is outside your scope.", status: 403 };
  const patch = { status };
  if (status === "acknowledged") {
    patch.acknowledged_at = new Date().toISOString();
    patch.acknowledged_by = user.preferred_name || user.full_name || user.email || "Someone";
  }
  const { data, error } = await supa.from("tp_corrective_actions").update(patch).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, action: data };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let user;
  try { user = await getSessionUser(event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  if (!VIEW_ROLES.has(String(user.role))) return respond(403, { error: "Talent Planning is for DO and above." });

  const params = event.queryStringParameters || {};
  const action = params.action || "rollup";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "rollup") return unwrap(await rollup(supa, user));
      if (action === "gms") return unwrap(await gms(supa, user));
      if (action === "store-roster") return unwrap(await storeRoster(supa, user, params.store_id));
      if (action === "notes") return unwrap(await listNotes(supa, user, params.member_id));
      if (action === "corrective-actions") return unwrap(await listCorrectiveActions(supa, user, params.member_id));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "seed-from-profiles") return unwrap(await seedFromProfiles(supa, user));
    if (action === "commit-plan") return unwrap(await commitPlan(supa, user, body));
    if (action === "update-member") return unwrap(await updateMember(supa, user, body));
    if (action === "add-note") return unwrap(await addNote(supa, user, body));
    if (action === "update-req") return unwrap(await updateReq(supa, user, body));
    if (action === "add-corrective-action") return unwrap(await addCorrectiveAction(supa, user, body));
    if (action === "corrective-action-status") return unwrap(await setCorrectiveActionStatus(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
