// qsr-manage.js — SOAR QSR above-store manager dashboard (Milestone 5).
//
// Admin/author-only. Pure server-side rollups off the existing tables
// (enrollments, profiles → stores → districts → markets → regions) plus
// course assignments. No numbers are computed client-side.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("qsr-manage env not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function isAuthor(role) {
  return ["admin"].includes(String(role));
}
// Store leaders + up can view/manage QR codes, scoped to their org.
const STORE_LEADER_ROLES = new Set(["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
const ORG_WIDE = new Set(["admin", "vp", "coo", "payroll"]);
const TOKEN_ACTIONS = new Set(["tokens", "mintToken", "revokeToken", "tokenStores", "mintAllStores"]);

// Store ids the caller may see (null = all, for org-wide roles).
async function visibleStoreIds(supa, user) {
  if (ORG_WIDE.has(String(user.role))) return null;
  const { data } = await supa.rpc("user_visible_stores", { uid: user.id });
  return new Set((data || []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores)).filter(Boolean));
}
const newToken = () =>
  `s_${(globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "")}`;
async function getUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles").select("id, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}
function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

const pct = (num, den) => (den ? Math.round((num / den) * 100) : 0);

// store id → { number, name, region } via the org chain.
async function storeRegionMap(supa) {
  const [{ data: stores }, { data: districts }, { data: markets }, { data: regions }] = await Promise.all([
    supa.from("stores").select("id, number, name, district_id"),
    supa.from("districts").select("id, market_id"),
    supa.from("markets").select("id, region_id"),
    supa.from("regions").select("id, name"),
  ]);
  const regionName = new Map((regions || []).map((r) => [r.id, r.name]));
  const marketRegion = new Map((markets || []).map((m) => [m.id, m.region_id]));
  const districtRegion = new Map((districts || []).map((d) => [d.id, marketRegion.get(d.market_id)]));
  return new Map((stores || []).map((s) => [s.id, {
    number: s.number, name: s.name, region: regionName.get(districtRegion.get(s.district_id)) || "—",
  }]));
}

async function overview(supa) {
  const [{ count: learners }, { count: published }, { data: enr }, { data: ledger }] = await Promise.all([
    supa.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supa.from("qsr_courses").select("id", { count: "exact", head: true }).eq("status", "published"),
    supa.from("qsr_enrollments").select("status"),
    supa.from("qsr_points_ledger").select("delta"),
  ]);
  const enrollments = (enr || []).length;
  const completions = (enr || []).filter((e) => e.status === "completed").length;
  const totalPoints = (ledger || []).reduce((s, r) => s + (r.delta || 0), 0);
  return {
    learners: learners || 0,
    publishedCourses: published || 0,
    enrollments,
    completions,
    completionRate: pct(completions, enrollments),
    totalPoints,
  };
}

async function byCourse(supa) {
  const [{ data: courses }, { data: enr }] = await Promise.all([
    supa.from("qsr_courses").select("id, title, status"),
    supa.from("qsr_enrollments").select("course_id, status"),
  ]);
  const m = new Map();
  for (const e of enr || []) {
    const row = m.get(e.course_id) || { enrolled: 0, completed: 0 };
    row.enrolled++;
    if (e.status === "completed") row.completed++;
    m.set(e.course_id, row);
  }
  return {
    courses: (courses || [])
      .map((c) => {
        const r = m.get(c.id) || { enrolled: 0, completed: 0 };
        return { ...c, ...r, rate: pct(r.completed, r.enrolled) };
      })
      .sort((a, b) => b.enrolled - a.enrolled),
  };
}

async function byStore(supa) {
  const storeInfo = await storeRegionMap(supa);
  const [{ data: profiles }, { data: enr }] = await Promise.all([
    supa.from("profiles").select("id, primary_store_id").eq("is_active", true),
    supa.from("qsr_enrollments").select("user_id, status"),
  ]);
  const userStore = new Map((profiles || []).map((p) => [p.id, p.primary_store_id]));
  const per = new Map();
  const bump = (sid) => { if (!per.has(sid)) per.set(sid, { learners: 0, enrolled: 0, completed: 0 }); return per.get(sid); };
  for (const p of profiles || []) if (p.primary_store_id) bump(p.primary_store_id).learners++;
  for (const e of enr || []) {
    const sid = userStore.get(e.user_id);
    if (!sid) continue;
    const row = bump(sid);
    row.enrolled++;
    if (e.status === "completed") row.completed++;
  }
  const rows = [];
  for (const [sid, m] of per) {
    const info = storeInfo.get(sid);
    if (!info) continue;
    rows.push({ store_id: sid, number: info.number, name: info.name, region: info.region, ...m, rate: pct(m.completed, m.enrolled) });
  }
  rows.sort((a, b) => a.region.localeCompare(b.region) || String(a.number).localeCompare(String(b.number)));
  return { stores: rows };
}

// Courses + stores for the assignment pickers.
async function targets(supa) {
  const storeInfo = await storeRegionMap(supa);
  const { data: courses } = await supa.from("qsr_courses").select("id, title, status").order("title");
  const stores = [...storeInfo.entries()]
    .map(([id, s]) => ({ id, number: s.number, name: s.name, region: s.region }))
    .sort((a, b) => String(a.number).localeCompare(String(b.number)));
  return { courses: courses || [], stores };
}

async function listAssignments(supa) {
  const { data: a } = await supa.from("qsr_assignments").select("*").order("created_at", { ascending: false });
  const list = a || [];
  const courseIds = [...new Set(list.map((x) => x.course_id))];
  const [{ data: courses }, { data: profiles }, { data: enr }] = await Promise.all([
    courseIds.length ? supa.from("qsr_courses").select("id, title").in("id", courseIds) : Promise.resolve({ data: [] }),
    supa.from("profiles").select("id, primary_store_id").eq("is_active", true),
    supa.from("qsr_enrollments").select("user_id, course_id, status"),
  ]);
  const titleById = new Map((courses || []).map((c) => [c.id, c.title]));
  const activeIds = new Set((profiles || []).map((p) => p.id));
  const usersForScope = (asg) => {
    if (asg.scope_type === "store") return new Set((profiles || []).filter((p) => p.primary_store_id === asg.scope_id).map((p) => p.id));
    if (asg.scope_type === "user") return new Set([asg.scope_id]);
    return activeIds; // 'all' (region/district fall back to org-wide for v1)
  };
  const assignments = list.map((asg) => {
    const users = usersForScope(asg);
    const completed = (enr || []).filter((e) => e.course_id === asg.course_id && e.status === "completed" && users.has(e.user_id)).length;
    return { ...asg, course_title: titleById.get(asg.course_id) || "—", total: users.size, completed };
  });
  return { assignments };
}

async function assign(supa, user, body) {
  const { course_id, scope_type, scope_id, scope_label, due_at } = body || {};
  if (!course_id) return { error: "course_id required.", status: 400 };
  if (!["all", "region", "district", "store", "user"].includes(scope_type)) return { error: "Invalid scope.", status: 400 };
  if (scope_type !== "all" && !scope_id) return { error: "Pick a target for this scope.", status: 400 };
  const { data, error } = await supa.from("qsr_assignments").insert({
    course_id,
    scope_type,
    scope_id: scope_type === "all" ? null : scope_id,
    scope_label: scope_label || (scope_type === "all" ? "Everyone" : null),
    due_at: due_at || null,
    assigned_by: user.id,
  }).select().single();
  if (error) throw error;
  return { assignment: data };
}

async function unassign(supa, body) {
  const { id } = body || {};
  if (!id) return { error: "id required.", status: 400 };
  const { error } = await supa.from("qsr_assignments").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

// Flat completion rows for an audit CSV.
async function completions(supa) {
  const { data: enr } = await supa.from("qsr_enrollments")
    .select("user_id, course_id, completed_at").eq("status", "completed");
  const list = enr || [];
  const userIds = [...new Set(list.map((e) => e.user_id))];
  const courseIds = [...new Set(list.map((e) => e.course_id))];
  const [{ data: profiles }, { data: courses }, storeInfo] = await Promise.all([
    userIds.length ? supa.from("profiles").select("id, full_name, preferred_name, primary_store_id").in("id", userIds) : Promise.resolve({ data: [] }),
    courseIds.length ? supa.from("qsr_courses").select("id, title").in("id", courseIds) : Promise.resolve({ data: [] }),
    storeRegionMap(supa),
  ]);
  const pById = new Map((profiles || []).map((p) => [p.id, p]));
  const cById = new Map((courses || []).map((c) => [c.id, c.title]));
  const rows = list.map((e) => {
    const p = pById.get(e.user_id);
    const si = p ? storeInfo.get(p.primary_store_id) : null;
    return {
      learner: p ? (p.preferred_name || p.full_name || "—") : "—",
      store: si ? `${si.number} — ${si.name}` : "—",
      region: si ? si.region : "—",
      course: cById.get(e.course_id) || "—",
      completed_at: e.completed_at,
    };
  }).sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || "")));
  return { rows };
}

// ── Public QR access tokens (one per store; see 0171 + qsr-public.js) ─────────
// Scoped to the caller's org: a GM sees their store's code, a DO their
// district's, an RVP their region's; admins/org-wide see all.
async function listTokens(supa, user) {
  const visible = await visibleStoreIds(supa, user);
  const { data } = await supa.from("qsr_access_tokens").select("*").order("created_at", { ascending: false });
  let toks = data || [];
  if (visible) toks = toks.filter((t) => visible.has(t.store_id));
  const storeIds = [...new Set(toks.map((t) => t.store_id))];
  const { data: stores } = storeIds.length
    ? await supa.from("stores").select("id, number, name").in("id", storeIds) : { data: [] };
  const byId = new Map((stores || []).map((s) => [s.id, s]));
  return { tokens: toks.map((t) => ({ ...t, store: byId.get(t.store_id) || null })) };
}
// The caller's stores, for the mint picker.
async function tokenStores(supa, user) {
  const visible = await visibleStoreIds(supa, user);
  let q = supa.from("stores").select("id, number, name").eq("is_active", true).order("number");
  if (visible) q = q.in("id", visible.size ? [...visible] : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  return { stores: data || [], canMintAll: isAuthor(user.role) };
}
async function mintToken(supa, user, body) {
  const { store_id, label } = body || {};
  if (!store_id) return { error: "store_id required.", status: 400 };
  const visible = await visibleStoreIds(supa, user);
  if (visible && !visible.has(store_id)) return { error: "That store is outside your scope.", status: 403 };
  // Reuse the store's existing active token so the posted QR stays stable.
  const { data: ex } = await supa.from("qsr_access_tokens")
    .select("*").eq("store_id", store_id).eq("is_active", true).is("revoked_at", null).maybeSingle();
  if (ex) return { token: ex };
  const { data, error } = await supa.from("qsr_access_tokens")
    .insert({ token: newToken(), store_id, label: label || null, created_by: user.id }).select().single();
  if (error) throw error;
  return { token: data };
}
// Admin: mint a code for every active store that doesn't have one yet.
async function mintAllStores(supa, user) {
  if (!isAuthor(user.role)) return { error: "Admins only.", status: 403 };
  const [{ data: stores }, { data: existing }] = await Promise.all([
    supa.from("stores").select("id").eq("is_active", true),
    supa.from("qsr_access_tokens").select("store_id").eq("is_active", true).is("revoked_at", null),
  ]);
  const have = new Set((existing || []).map((t) => t.store_id));
  const rows = (stores || []).filter((s) => !have.has(s.id)).map((s) => ({ token: newToken(), store_id: s.id, created_by: user.id }));
  if (rows.length) { const { error } = await supa.from("qsr_access_tokens").insert(rows); if (error) throw error; }
  return { created: rows.length, total: (stores || []).length };
}
async function revokeToken(supa, user, body) {
  const { id } = body || {};
  if (!id) return { error: "id required.", status: 400 };
  const { data: tok } = await supa.from("qsr_access_tokens").select("store_id").eq("id", id).maybeSingle();
  if (!tok) return { error: "Code not found.", status: 404 };
  const visible = await visibleStoreIds(supa, user);
  if (visible && !visible.has(tok.store_id)) return { error: "That store is outside your scope.", status: 403 };
  const { error } = await supa.from("qsr_access_tokens")
    .update({ is_active: false, revoked_at: new Date().toISOString(), revoked_by: user.id }).eq("id", id);
  if (error) throw error;
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getUser(supa, event).catch(() => null);
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "overview";
  // QR-code actions are open to store leaders (scoped to their org); the rest of
  // the manager dashboard stays admin/author-only.
  if (TOKEN_ACTIONS.has(action)) {
    if (!STORE_LEADER_ROLES.has(String(user.role))) return respond(403, { error: "forbidden" });
  } else if (!isAuthor(user.role)) {
    return respond(403, { error: "forbidden" });
  }
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    if (action === "overview") return unwrap(await overview(supa));
    if (action === "byCourse") return unwrap(await byCourse(supa));
    if (action === "byStore") return unwrap(await byStore(supa));
    if (action === "targets") return unwrap(await targets(supa));
    if (action === "assignments") return unwrap(await listAssignments(supa));
    if (action === "assign") return unwrap(await assign(supa, user, body));
    if (action === "unassign") return unwrap(await unassign(supa, body));
    if (action === "tokens") return unwrap(await listTokens(supa, user));
    if (action === "tokenStores") return unwrap(await tokenStores(supa, user));
    if (action === "mintToken") return unwrap(await mintToken(supa, user, body));
    if (action === "mintAllStores") return unwrap(await mintAllStores(supa, user));
    if (action === "revokeToken") return unwrap(await revokeToken(supa, user, body));
    if (action === "completions") return unwrap(await completions(supa));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
