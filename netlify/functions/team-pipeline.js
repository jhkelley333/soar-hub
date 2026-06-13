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
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "seed-from-profiles") return unwrap(await seedFromProfiles(supa, user));
    if (action === "commit-plan") return unwrap(await commitPlan(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
