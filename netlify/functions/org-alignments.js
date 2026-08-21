// org-alignments — admin API for the Org Alignment tool (migration 0308). Stage
// a structural org realignment (new regions/areas/districts + reparent existing
// stores/districts/areas) and apply it on an effective date. Admin-only; the
// apply/rollback engine lives in _lib/orgAlignment.js (shared with the
// scheduled auto-applier).

import { createClient } from "@supabase/supabase-js";
import { applyAlignment, rollbackAlignment } from "./_lib/orgAlignment.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function admin() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function respond(s, p) { return { statusCode: s, headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }; }
const unwrap = (r) => (r && r.error ? respond(r.status || 500, { error: r.error }) : respond(200, { ok: true, ...r }));

async function sessionUser(supa, event) {
  const h = event.headers?.authorization || event.headers?.Authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (!token) return null;
  const { data: u, error } = await supa.auth.getUser(token);
  if (error || !u?.user) return null;
  const { data: p } = await supa.from("profiles").select("id, role, is_active").eq("id", u.user.id).single();
  if (!p || p.is_active === false) return null;
  return p;
}

const clean = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const KINDS_NODE = new Set(["region", "area", "district"]);
const KINDS_MOVE = new Set(["store", "district", "area"]);

// The whole live org tree, for the pickers + name resolution in the UI.
async function orgTree(supa) {
  const [{ data: regions }, { data: areas }, { data: districts }, { data: stores }] = await Promise.all([
    supa.from("regions").select("id, code, name").order("code"),
    supa.from("areas").select("id, code, name, region_id, is_active").order("code"),
    supa.from("districts").select("id, code, name, area_id, is_active").order("code"),
    supa.from("stores").select("id, number, name, district_id, is_active").eq("is_active", true).order("number"),
  ]);
  return { regions: regions || [], areas: areas || [], districts: districts || [], stores: stores || [] };
}

async function loadAlignment(supa, id) {
  const { data: alignment } = await supa.from("org_alignments").select("*").eq("id", id).maybeSingle();
  if (!alignment) return null;
  // NB: org_alignment_nodes has no created_at column — ordering by one makes
  // PostgREST error and silently drops every staged node. Order by real columns.
  const [{ data: nodes, error: nErr }, { data: moves, error: mErr }, { data: leaderMoves, error: lErr }] = await Promise.all([
    supa.from("org_alignment_nodes").select("*").eq("alignment_id", id).order("kind").order("code"),
    supa.from("org_alignment_moves").select("*").eq("alignment_id", id),
    supa.from("org_alignment_leader_moves").select("*").eq("alignment_id", id).order("created_at"),
  ]);
  if (nErr) throw new Error(`load nodes: ${nErr.message}`);
  if (mErr) throw new Error(`load moves: ${mErr.message}`);
  if (lErr) throw new Error(`load leader moves: ${lErr.message}`);
  return { ...alignment, nodes: nodes || [], moves: moves || [], leader_moves: leaderMoves || [] };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "env not configured" });
  const supa = admin();

  let user;
  try { user = await sessionUser(supa, event); } catch (e) { return respond(500, { error: e?.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  if (String(user.role || "").toLowerCase() !== "admin") return respond(403, { error: "Admins only." });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";

  try {
    if (event.httpMethod === "GET") {
      if (action === "list") {
        const { data, error } = await supa.from("org_alignments").select("*").order("effective_date", { ascending: false }).order("created_at", { ascending: false });
        if (error) {
          if (/org_alignments/.test(error.message)) return respond(500, { error: "Run migration 0308 first (org_alignments table is missing)." });
          return respond(500, { error: error.message });
        }
        // Change counts per alignment.
        const ids = (data || []).map((a) => a.id);
        const counts = {};
        if (ids.length) {
          const [{ data: ns }, { data: ms }, { data: ls }] = await Promise.all([
            supa.from("org_alignment_nodes").select("alignment_id").in("alignment_id", ids),
            supa.from("org_alignment_moves").select("alignment_id").in("alignment_id", ids),
            supa.from("org_alignment_leader_moves").select("alignment_id").in("alignment_id", ids),
          ]);
          const bump = (id) => (counts[id] ||= { nodes: 0, moves: 0, leaders: 0 });
          for (const r of ns || []) bump(r.alignment_id).nodes++;
          for (const r of ms || []) bump(r.alignment_id).moves++;
          for (const r of ls || []) bump(r.alignment_id).leaders++;
        }
        return respond(200, { ok: true, alignments: (data || []).map((a) => ({ ...a, change_count: counts[a.id] || { nodes: 0, moves: 0, leaders: 0 } })) });
      }
      if (action === "get") {
        const a = await loadAlignment(supa, clean(params.id, 64));
        if (!a) return respond(404, { error: "Alignment not found." });
        return respond(200, { ok: true, alignment: a });
      }
      if (action === "org-tree") return respond(200, { ok: true, ...(await orgTree(supa)) });
      return respond(400, { error: `unknown GET action: ${action}` });
    }

    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      const editable = async (id) => {
        const { data } = await supa.from("org_alignments").select("status").eq("id", id).maybeSingle();
        if (!data) return "Alignment not found.";
        if (data.status === "applied") return "This alignment is applied — roll it back before editing.";
        return null;
      };

      if (action === "create") {
        const name = clean(body.name, 120);
        if (!name) return respond(400, { error: "name is required." });
        if (!isDate(body.effective_date)) return respond(400, { error: "effective_date (YYYY-MM-DD) is required." });
        const { data, error } = await supa.from("org_alignments").insert({
          name, effective_date: String(body.effective_date).slice(0, 10), notes: clean(body.notes, 1000), created_by: user.id,
        }).select().single();
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true, alignment: { ...data, nodes: [], moves: [] } });
      }

      if (action === "update") {
        const id = clean(body.id, 64);
        if (!id) return respond(400, { error: "id is required." });
        const patch = { updated_at: new Date().toISOString() };
        if (body.name !== undefined) { const n = clean(body.name, 120); if (!n) return respond(400, { error: "name can't be blank." }); patch.name = n; }
        if (body.effective_date !== undefined) { if (!isDate(body.effective_date)) return respond(400, { error: "effective_date must be YYYY-MM-DD." }); patch.effective_date = String(body.effective_date).slice(0, 10); }
        if (body.notes !== undefined) patch.notes = clean(body.notes, 1000);
        if (body.status !== undefined) {
          const s = clean(body.status, 20);
          if (!["draft", "scheduled", "canceled"].includes(s)) return respond(400, { error: "status can only be set to draft, scheduled, or canceled." });
          patch.status = s;
        }
        const { data, error } = await supa.from("org_alignments").update(patch).eq("id", id).neq("status", "applied").select().maybeSingle();
        if (error) return respond(500, { error: error.message });
        if (!data) return respond(409, { error: "Not found, or it's applied — roll it back first." });
        return respond(200, { ok: true, alignment: data });
      }

      if (action === "add-node") {
        const blocked = await editable(clean(body.alignment_id, 64)); if (blocked) return respond(409, { error: blocked });
        const kind = clean(body.kind, 20);
        if (!KINDS_NODE.has(kind)) return respond(400, { error: "kind must be region, area, or district." });
        const name = clean(body.name, 120), code = clean(body.code, 40), ref = clean(body.ref, 60);
        if (!name || !code || !ref) return respond(400, { error: "ref, name, and code are required." });
        if (kind !== "region" && !clean(body.parent_id, 64) && !clean(body.parent_ref, 60)) {
          return respond(400, { error: `A new ${kind} needs a parent (${kind === "area" ? "region" : "area"}).` });
        }
        const { data, error } = await supa.from("org_alignment_nodes").insert({
          alignment_id: body.alignment_id, ref, kind, name, code,
          parent_id: kind === "region" ? null : clean(body.parent_id, 64),
          parent_ref: kind === "region" ? null : clean(body.parent_ref, 60),
        }).select().single();
        if (error) return respond(500, { error: /unique/.test(error.message) ? "That ref is already used in this alignment." : error.message });
        return respond(200, { ok: true, node: data });
      }

      if (action === "add-move") {
        const blocked = await editable(clean(body.alignment_id, 64)); if (blocked) return respond(409, { error: blocked });
        const kind = clean(body.kind, 20);
        if (!KINDS_MOVE.has(kind)) return respond(400, { error: "kind must be store, district, or area." });
        const nodeId = clean(body.node_id, 64);
        if (!nodeId) return respond(400, { error: "node_id is required." });
        if (!clean(body.new_parent_id, 64) && !clean(body.new_parent_ref, 60)) return respond(400, { error: "A new parent is required." });
        const { data, error } = await supa.from("org_alignment_moves").insert({
          alignment_id: body.alignment_id, kind, node_id: nodeId,
          new_parent_id: clean(body.new_parent_id, 64), new_parent_ref: clean(body.new_parent_ref, 60),
        }).select().single();
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true, move: data });
      }

      if (action === "remove-node") {
        const id = clean(body.id, 64); if (!id) return respond(400, { error: "id is required." });
        const { error } = await supa.from("org_alignment_nodes").delete().eq("id", id);
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true });
      }
      if (action === "remove-move") {
        const id = clean(body.id, 64); if (!id) return respond(400, { error: "id is required." });
        const { error } = await supa.from("org_alignment_moves").delete().eq("id", id);
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true });
      }

      if (action === "add-leader-move") {
        const blocked = await editable(clean(body.alignment_id, 64)); if (blocked) return respond(409, { error: blocked });
        const scopeType = clean(body.scope_type, 20);
        if (!["area", "district"].includes(scopeType)) return respond(400, { error: "scope_type must be area or district." });
        const userId = clean(body.user_id, 64);
        if (!userId) return respond(400, { error: "user_id is required." });
        if (!clean(body.to_scope_id, 64) && !clean(body.to_scope_ref, 60)) return respond(400, { error: "A destination scope is required." });
        const { data, error } = await supa.from("org_alignment_leader_moves").insert({
          alignment_id: body.alignment_id, user_id: userId, scope_type: scopeType,
          from_scope_id: clean(body.from_scope_id, 64),
          to_scope_id: clean(body.to_scope_id, 64), to_scope_ref: clean(body.to_scope_ref, 60),
        }).select().single();
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true, leader_move: data });
      }
      if (action === "remove-leader-move") {
        const id = clean(body.id, 64); if (!id) return respond(400, { error: "id is required." });
        const { error } = await supa.from("org_alignment_leader_moves").delete().eq("id", id);
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true });
      }

      if (action === "delete") {
        const id = clean(body.id, 64); if (!id) return respond(400, { error: "id is required." });
        const { data, error } = await supa.from("org_alignments").delete().eq("id", id).neq("status", "applied").select("id").maybeSingle();
        if (error) return respond(500, { error: error.message });
        if (!data) return respond(409, { error: "Not found, or it's applied — roll it back before deleting." });
        return respond(200, { ok: true });
      }

      if (action === "apply") return unwrap(await applyAlignment(supa, clean(body.id, 64), user.id));
      if (action === "rollback") return unwrap(await rollbackAlignment(supa, clean(body.id, 64), user.id));

      return respond(400, { error: `unknown POST action: ${action}` });
    }

    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e?.message || "server error" });
  }
};
