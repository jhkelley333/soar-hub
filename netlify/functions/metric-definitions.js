// metric-definitions — read the plain-language metric registry (any signed-in
// user) and manage it (admins). Powers the reusable <MetricInfo> tooltip and
// the /admin/definitions management page.

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

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "env not configured" });
  const supa = admin();

  let user;
  try { user = await sessionUser(supa, event); } catch (e) { return respond(500, { error: e?.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  const isAdmin = String(user.role || "").toLowerCase() === "admin";

  const params = event.queryStringParameters || {};
  const action = params.action || "list";

  try {
    if (event.httpMethod === "GET" && action === "list") {
      const { data } = await supa.from("metric_definitions")
        .select("key, label, definition, source, category, sort_order")
        .order("sort_order").order("label");
      return respond(200, { ok: true, definitions: data || [] });
    }

    if (event.httpMethod === "POST") {
      if (!isAdmin) return respond(403, { error: "Admins only." });
      const body = event.body ? JSON.parse(event.body) : {};

      if (action === "upsert") {
        const key = clean(body.key, 80);
        if (!key || !/^[a-z0-9_]+$/.test(key)) return respond(400, { error: "key must be lowercase letters, numbers, and underscores." });
        const label = clean(body.label, 120);
        const definition = clean(body.definition, 2000);
        if (!label || !definition) return respond(400, { error: "label and definition are required." });
        const row = {
          key, label, definition,
          source: clean(body.source, 200),
          category: clean(body.category, 80),
          sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 100,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        };
        const { data, error } = await supa.from("metric_definitions").upsert(row, { onConflict: "key" }).select().maybeSingle();
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true, definition: data });
      }

      if (action === "delete") {
        const key = clean(body.key, 80);
        if (!key) return respond(400, { error: "key is required." });
        const { error } = await supa.from("metric_definitions").delete().eq("key", key);
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
