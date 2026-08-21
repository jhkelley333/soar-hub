// ranker-credentials — admin-only credential vault for the Ranker's external
// data sources (shared logins for IX / EcoSure / KnowledgeForce / Qualtrics /
// RAP / Skunkworks, etc.). Every action requires the admin role; the values are
// secrets. Passwords are stored as text (see migration 0305) — this is a shared
// vault, not a secrets manager.
//
//   GET  ?action=list                 -> all entries (admin only)
//   POST ?action=upsert  {id?, label, url?, username?, password?, notes?, sort_order?}
//   POST ?action=delete  {id}

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function admin() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function respond(statusCode, payload) { return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }; }

async function sessionUser(supa, event) {
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

const clean = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);

// True if the RVP has an active Ranker delegation (migration 0306) — lets them
// READ the vault to log in and pull. Editing stays admin-only.
async function hasActiveDelegation(supa, userId) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const { data, error } = await supa.from("ranker_delegations")
    .select("id").eq("user_id", userId).is("revoked_at", null)
    .lte("starts_on", today).gte("ends_on", today).limit(1);
  if (error) return false;
  return !!(data && data.length);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "env not configured" });
  const supa = admin();

  let user;
  try { user = await sessionUser(supa, event); } catch (e) { return respond(500, { error: e?.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  const role = String(user.role || "").toLowerCase();
  const isAdmin = role === "admin";

  const params = event.queryStringParameters || {};
  const action = params.action || "list";

  // Reading the vault: admin, or an RVP with an active Ranker delegation.
  // Writing (upsert/delete) is always admin-only.
  if (!isAdmin) {
    const mayRead = event.httpMethod === "GET" && action === "list" && role === "rvp" && await hasActiveDelegation(supa, user.id);
    if (!mayRead) return respond(403, { error: "Admins only." });
  }

  try {
    if (event.httpMethod === "GET" && action === "list") {
      const { data, error } = await supa.from("ranker_credentials")
        .select("id, label, url, username, password, notes, sort_order, updated_at")
        .order("sort_order").order("label");
      if (error) {
        if (/ranker_credentials/.test(error.message)) return respond(500, { error: "Run migration 0305 first (ranker_credentials table is missing)." });
        return respond(500, { error: error.message });
      }
      return respond(200, { ok: true, entries: data || [] });
    }

    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};

      if (action === "upsert") {
        const label = clean(body.label, 120);
        if (!label) return respond(400, { error: "label is required." });
        const row = {
          label,
          url: clean(body.url, 2000),
          username: clean(body.username, 200),
          password: clean(body.password, 500),
          notes: clean(body.notes, 2000),
          sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 100,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        };
        if (body.id) row.id = clean(body.id, 64);
        const { data, error } = await supa.from("ranker_credentials").upsert(row).select().maybeSingle();
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true, entry: data });
      }

      if (action === "delete") {
        const id = clean(body.id, 64);
        if (!id) return respond(400, { error: "id is required." });
        const { error } = await supa.from("ranker_credentials").delete().eq("id", id);
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true });
      }

      return respond(400, { error: `unknown POST action: ${action}` });
    }

    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e?.message || "server error" });
  }
};
