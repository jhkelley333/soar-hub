// Standing "stay logged in" access links. A token in the URL (/go/<token>) is
// bound to a specific profile. Opening it mints a fresh one-time Supabase login
// server-side and signs that device in as that user; the device then stays
// logged in normally (refresh tokens). The token is REUSABLE until revoked, so
// a leaked link is a full credential for that user — mint/revoke is admin/VP/COO
// only, and every open is logged (last_used_at / ua / ip) for auditing.
//
// Actions:
//   GET  ?action=login&token=…      PUBLIC — token → { email, otp } for client verifyOtp
//   GET  ?action=list               admin/VP/COO — active links + candidate users
//   POST { action:"mint", user_id } admin/VP/COO — create (or reuse) a link
//   POST { action:"revoke", id }    admin/VP/COO — deactivate a link

import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MANAGE_ROLES = new Set(["admin", "vp", "coo"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("access-link env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
const roleOf = (u) => String(u?.role || "").toLowerCase();

async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const newToken = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);

// ── PUBLIC: token → fresh one-time login ────────────────────────────────
// Validates the token, mints a magic-link OTP for the bound profile, records
// the open, and returns { email, otp } for the client to verifyOtp with.
async function login(supa, token, meta) {
  if (!token) return { error: "missing token", status: 400 };
  const { data: row } = await supa
    .from("access_tokens")
    .select("id, user_id, is_active, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!row || !row.is_active || row.revoked_at) return { error: "This link is no longer active.", status: 403 };
  if (row.expires_at && row.expires_at < new Date().toISOString()) return { error: "This link has expired.", status: 403 };

  const { data: prof } = await supa
    .from("profiles")
    .select("id, email, is_active")
    .eq("id", row.user_id)
    .maybeSingle();
  if (!prof || prof.is_active === false || !prof.email) return { error: "This link's account is unavailable.", status: 403 };

  const { data: gen, error: genErr } = await supa.auth.admin.generateLink({ type: "magiclink", email: prof.email });
  if (genErr || !gen?.properties?.email_otp) return { error: genErr?.message || "Could not start sign-in.", status: 500 };

  await supa
    .from("access_tokens")
    .update({ last_used_at: new Date().toISOString(), last_used_ua: meta.ua || null, last_used_ip: meta.ip || null })
    .eq("id", row.id);

  return { email: prof.email, otp: gen.properties.email_otp };
}

// ── admin/VP/COO: list active links + candidate users ───────────────────
async function list(supa, user) {
  if (!MANAGE_ROLES.has(roleOf(user))) return { error: "forbidden", status: 403 };
  const [{ data: tokens }, { data: profiles }] = await Promise.all([
    supa
      .from("access_tokens")
      .select("id, token, user_id, label, created_at, last_used_at, last_used_ip, expires_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supa
      .from("profiles")
      .select("id, full_name, preferred_name, email, role")
      .eq("is_active", true)
      .order("full_name"),
  ]);
  const pm = new Map((profiles || []).map((p) => [p.id, p]));
  return {
    links: (tokens || []).map((t) => {
      const p = pm.get(t.user_id);
      return {
        ...t,
        user_name: p ? p.preferred_name || p.full_name || p.email : "(unknown)",
        user_email: p?.email ?? null,
        user_role: p?.role ?? null,
      };
    }),
    users: (profiles || []).map((p) => ({
      id: p.id,
      name: p.preferred_name || p.full_name || p.email,
      email: p.email,
      role: p.role,
    })),
  };
}

async function mint(supa, user, body) {
  if (!MANAGE_ROLES.has(roleOf(user))) return { error: "forbidden", status: 403 };
  const userId = body?.user_id;
  if (!userId) return { error: "user_id required", status: 400 };
  const { data: target } = await supa.from("profiles").select("id, is_active").eq("id", userId).maybeSingle();
  if (!target || target.is_active === false) return { error: "That user is not available.", status: 400 };
  const label = (body?.label || "").trim() || null;

  // Reuse an existing active link for the same user rather than minting a duplicate.
  const { data: existing } = await supa
    .from("access_tokens")
    .select("id, token")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (existing) return { token: existing.token, id: existing.id, reused: true };

  const token = newToken();
  const { data, error } = await supa
    .from("access_tokens")
    .insert({ token, user_id: userId, label, created_by: user.id })
    .select("id, token")
    .single();
  if (error) return { error: error.message, status: 500 };
  return { token: data.token, id: data.id, reused: false };
}

async function revoke(supa, user, body) {
  if (!MANAGE_ROLES.has(roleOf(user))) return { error: "forbidden", status: 403 };
  const id = body?.id;
  if (!id) return { error: "id required", status: 400 };
  const { error } = await supa
    .from("access_tokens")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); }
  catch (e) { return respond(500, { error: e.message }); }

  const params = event.queryStringParameters || {};

  // PUBLIC — token login, handled before the auth gate. Token is the credential.
  if (event.httpMethod === "GET" && params.action === "login") {
    try {
      const ua = event.headers?.["user-agent"] || event.headers?.["User-Agent"] || null;
      const ip = (event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || "").split(",")[0].trim() || null;
      const out = await login(supa, params.token, { ua, ip });
      return out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out });
    } catch (e) {
      return respond(500, { error: e.message || "server error" });
    }
  }

  let user;
  try { user = await getSessionUser(supa, event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });

  const unwrap = (out) => (out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out }));
  try {
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      const action = body.action || params.action;
      if (action === "mint") return unwrap(await mint(supa, user, body));
      if (action === "revoke") return unwrap(await revoke(supa, user, body));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (params.action === "list") return unwrap(await list(supa, user));
    return respond(400, { error: `Unknown action: ${params.action}` });
  } catch (e) {
    return respond(500, { error: `access-link error: ${e?.message || String(e)}` });
  }
};
