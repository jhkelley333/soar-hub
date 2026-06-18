// netlify/functions/region-access.js
//
// Read/write the per-region module-visibility overrides backing the Region
// Access admin page. The region axis mirrors role-access's role axis.
//
//   GET  ?action=list            — any signed-in user. Returns:
//                                     overrides[]  { module_key, region_id, visible }
//                                     regions[]    { id, name, code }  (matrix columns)
//                                     myRegionIds  the caller's region(s), for gating.
//   POST ?action=set   (admin)   — { module_key, region_id, visible } upsert.
//   POST ?action=clear (admin)   — { module_key, region_id } delete (→ default visible).
//
// Overrides are deviations from the default (every region sees every module);
// an empty table = today's behavior. Governs UI visibility only — backend
// role checks + RLS remain the real data boundary.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("region-access env not configured");
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

// Resolve the region(s) a caller belongs to by walking their scopes up the
// org hierarchy: store → district → area → region (or a direct region scope
// for RVPs). A global scope (VP/COO/admin) returns [] — they're never
// region-gated, so they see everything their role allows.
async function callerRegionIds(supa, userId) {
  const { data: scopes } = await supa
    .from("user_scopes")
    .select("scope_type, scope_id")
    .eq("user_id", userId);
  if (!scopes?.length) return [];
  if (scopes.some((s) => s.scope_type === "global")) return [];

  const regionIds = new Set();
  const areaIds = new Set();
  const districtIds = new Set();
  const storeIds = new Set();
  for (const s of scopes) {
    if (!s.scope_id) continue;
    if (s.scope_type === "region") regionIds.add(s.scope_id);
    else if (s.scope_type === "area") areaIds.add(s.scope_id);
    else if (s.scope_type === "district") districtIds.add(s.scope_id);
    else if (s.scope_type === "store") storeIds.add(s.scope_id);
  }
  if (storeIds.size) {
    const { data } = await supa.from("stores").select("district_id").in("id", [...storeIds]);
    for (const r of data || []) if (r.district_id) districtIds.add(r.district_id);
  }
  if (districtIds.size) {
    const { data } = await supa.from("districts").select("area_id").in("id", [...districtIds]);
    for (const r of data || []) if (r.area_id) areaIds.add(r.area_id);
  }
  if (areaIds.size) {
    const { data } = await supa.from("areas").select("region_id").in("id", [...areaIds]);
    for (const r of data || []) if (r.region_id) regionIds.add(r.region_id);
  }
  return [...regionIds];
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
      const [{ data: overrides, error: oErr }, { data: regions, error: rErr }, myRegionIds] =
        await Promise.all([
          supa.from("region_module_access").select("module_key, region_id, visible"),
          supa.from("regions").select("id, name, code").eq("is_active", true).order("name"),
          callerRegionIds(supa, caller.id),
        ]);
      if (oErr) throw oErr;
      if (rErr) throw rErr;
      return respond(200, {
        ok: true,
        overrides: overrides || [],
        regions: regions || [],
        myRegionIds,
      });
    }

    if (event.httpMethod === "POST" && (action === "set" || action === "clear")) {
      if (caller.role !== "admin") {
        return respond(403, { ok: false, message: "Admins only." });
      }
      const body = event.body ? JSON.parse(event.body) : {};
      const moduleKey = String(body.module_key || "").trim();
      const regionId = String(body.region_id || "").trim();
      if (!moduleKey || !regionId) {
        return respond(400, { ok: false, message: "module_key and region_id are required." });
      }

      if (action === "clear") {
        const { error } = await supa
          .from("region_module_access")
          .delete()
          .eq("module_key", moduleKey)
          .eq("region_id", regionId);
        if (error) throw error;
        return respond(200, { ok: true });
      }

      const { error } = await supa
        .from("region_module_access")
        .upsert(
          { module_key: moduleKey, region_id: regionId, visible: body.visible === true, updated_by_id: caller.id, updated_at: new Date().toISOString() },
          { onConflict: "module_key,region_id" },
        );
      if (error) throw error;
      return respond(200, { ok: true });
    }

    return respond(400, { ok: false, message: `unknown action: ${action}` });
  } catch (e) {
    return respond(500, { ok: false, message: e.message || "server error" });
  }
};
