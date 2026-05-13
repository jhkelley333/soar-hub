// netlify/functions/feature-flags.js
//
// Feature flag CRUD + caller-scoped resolution.
//
// Actions:
//   * resolveAll  GET  — any authenticated user. Returns
//                        { key: boolean } resolved against this caller
//                        (using their primary store + user id for
//                        allowlist matching). Powers the frontend
//                        useFlag() hook.
//   * list        GET  — admin only. Raw rows for the admin editor.
//   * upsert      POST — admin only. Create or update a flag row.
//   * delete      POST — admin only. Drop a flag row.
//
// No v2 wiring lives here — this function is a pure infra primitive
// shipped in PR 0 so subsequent phases can gate behind named flags.

import { createClient } from "@supabase/supabase-js";
import { resolveAll } from "./_lib/flags.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function getCallerProfile(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = getSupabase();
  const { data: userRes } = await supa.auth.getUser(token);
  if (!userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active, primary_store_id")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

// Best-effort store-number lookup so allowlist_stores matching works
// even when the caller's primary_store_id is set but no scope rows.
// Returns null silently on any miss.
async function storeNumberForCaller(supabase, profile) {
  if (!profile?.primary_store_id) return null;
  const { data } = await supabase
    .from("stores")
    .select("number")
    .eq("id", profile.primary_store_id)
    .maybeSingle();
  return data?.number ? String(data.number) : null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  try {
    const profile = await getCallerProfile(event);
    if (!profile) {
      return respond(401, { ok: false, message: "Sign in required." });
    }
    const supabase = getSupabase();
    const role = String(profile.role || "").toLowerCase();
    const action = (event.queryStringParameters || {}).action || "resolveAll";

    // ── resolveAll: any authenticated user ─────────────────────────
    if (action === "resolveAll") {
      const storeNumber = await storeNumberForCaller(supabase, profile);
      const flags = await resolveAll(supabase, {
        storeNumber,
        userId: profile.id,
      });
      return respond(200, { ok: true, flags });
    }

    // ── list / upsert / delete: admin only ─────────────────────────
    if (role !== "admin") {
      return respond(403, { ok: false, message: "Admin only." });
    }

    if (action === "list") {
      const { data, error } = await supabase
        .from("feature_flags")
        .select("key, enabled, allowlist_stores, allowlist_user_ids, notes, updated_at, updated_by_id")
        .order("key");
      if (error) throw error;
      return respond(200, { ok: true, flags: data || [] });
    }

    if (action === "upsert" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const key = String(body.key || "").trim();
      if (!key) {
        return respond(400, { ok: false, message: "key is required." });
      }
      const payload = {
        key,
        enabled: body.enabled === true,
        allowlist_stores: Array.isArray(body.allowlist_stores)
          ? body.allowlist_stores.map(String).filter(Boolean)
          : [],
        allowlist_user_ids: Array.isArray(body.allowlist_user_ids)
          ? body.allowlist_user_ids.filter((id) => typeof id === "string" && id.length > 0)
          : [],
        notes: typeof body.notes === "string" ? body.notes : null,
        updated_by_id: profile.id,
      };
      const { data, error } = await supabase
        .from("feature_flags")
        .upsert(payload, { onConflict: "key" })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, flag: data });
    }

    if (action === "delete" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const key = String(body.key || "").trim();
      if (!key) {
        return respond(400, { ok: false, message: "key is required." });
      }
      const { error } = await supabase
        .from("feature_flags")
        .delete()
        .eq("key", key);
      if (error) throw error;
      return respond(200, { ok: true });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    return respond(500, {
      ok: false,
      message: err?.message || "Internal error.",
    });
  }
};
