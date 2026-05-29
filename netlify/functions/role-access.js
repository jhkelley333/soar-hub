// netlify/functions/role-access.js
//
// Read/write the per-role module-visibility overrides backing the Role
// Access admin page.
//
//   GET  ?action=list            — any signed-in user. Returns overrides[]
//                                   so the nav + route guards can resolve.
//   POST ?action=set   (admin)   — { module_key, role, visible } upsert.
//   POST ?action=clear (admin)   — { module_key, role } delete (→ default).
//
// Overrides are deviations from the code defaults; an empty table = the
// hardcoded nav.ts behavior. This governs UI visibility only — backend
// role checks + RLS remain the real data boundary.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALL_ROLES = [
  "shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "payroll", "admin",
];

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("role-access env not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getCaller(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let caller;
  try {
    caller = await getCaller(event);
  } catch (e) {
    return respond(500, { ok: false, message: e.message || "auth failed" });
  }
  if (!caller) return respond(401, { ok: false, message: "unauthorized" });

  const action = (event.queryStringParameters || {}).action || "list";
  const supa = admin();

  try {
    if (event.httpMethod === "GET" && action === "list") {
      const { data, error } = await supa
        .from("role_module_access")
        .select("module_key, role, visible");
      if (error) throw error;
      return respond(200, { ok: true, overrides: data || [] });
    }

    if (event.httpMethod === "POST" && (action === "set" || action === "clear")) {
      if (caller.role !== "admin") {
        return respond(403, { ok: false, message: "Admins only." });
      }
      const body = event.body ? JSON.parse(event.body) : {};
      const moduleKey = String(body.module_key || "").trim();
      const role = String(body.role || "").trim();
      if (!moduleKey || !ALL_ROLES.includes(role)) {
        return respond(400, { ok: false, message: "module_key and a valid role are required." });
      }
      // Guard rail: never let admins lock themselves (the admin role) out
      // of anything. Admin always sees every module.
      if (role === "admin") {
        return respond(400, { ok: false, message: "The admin role always has full access and can't be overridden." });
      }

      if (action === "clear") {
        const { error } = await supa
          .from("role_module_access")
          .delete()
          .eq("module_key", moduleKey)
          .eq("role", role);
        if (error) throw error;
        return respond(200, { ok: true });
      }

      const { error } = await supa
        .from("role_module_access")
        .upsert(
          { module_key: moduleKey, role, visible: body.visible === true, updated_by_id: caller.id, updated_at: new Date().toISOString() },
          { onConflict: "module_key,role" },
        );
      if (error) throw error;
      return respond(200, { ok: true });
    }

    return respond(400, { ok: false, message: `unknown action: ${action}` });
  } catch (e) {
    return respond(500, { ok: false, message: e.message || "server error" });
  }
};
