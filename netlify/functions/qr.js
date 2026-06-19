// netlify/functions/qr.js
//
// Service-role backend for the dynamic QR code generator. GM and above can
// mint a QR (a stable short code), then later edit where it points without
// reprinting. All actions are authed (bearer JWT) and role-gated server-side;
// the public redirect lives in qr-redirect.js.
//
// Actions (query ?action=...):
//   list    GET                      -> { codes: [...] }
//   create  POST { label, target_url } -> { code }
//   update  POST { id, label?, target_url? } -> { code }
//   toggle  POST { id, is_active }    -> { code }
//   delete  POST { id }              -> { ok: true }
//
// Pattern follows netlify/functions/reno-scoping.js (admin() + getSessionUser()).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROLE_LEVEL = {
  shift_manager: 10, first_assistant_manager: 10, associate_manager: 10,
  crew_leader: 10, crew_member: 10, carhop: 10,
  gm: 20, do: 30, sdo: 40, rvp: 50, vp: 60, coo: 70, admin: 100, payroll: null,
};
const MIN_LEVEL = ROLE_LEVEL.gm; // GM and above

// Slug alphabet excludes ambiguous chars (0/O, 1/I/L) so a code is easy to
// read off a printout if someone ever has to type it.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("qr env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles").select("id, email, full_name, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function genCode(n = 7) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// Accept bare domains too; default to https and reject anything that isn't a
// real http(s) URL so a QR can never point at javascript:/data: etc.
function normalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const url = new URL(u);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Attach the creator's display name without a fragile PostgREST embed.
async function withCreators(supa, rows) {
  const ids = [...new Set(rows.map((r) => r.created_by_id).filter(Boolean))];
  let nameById = new Map();
  if (ids.length) {
    const { data: people } = await supa.from("profiles").select("id, full_name, preferred_name").in("id", ids);
    nameById = new Map((people || []).map((p) => [p.id, p.preferred_name || p.full_name || null]));
  }
  return rows.map((r) => ({ ...r, created_by_name: nameById.get(r.created_by_id) || null }));
}

async function listCodes(supa) {
  const { data, error } = await supa
    .from("qr_codes")
    .select("id, code, label, target_url, is_active, scan_count, created_by_id, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { codes: await withCreators(supa, data || []) };
}

async function createCode(supa, user, body) {
  const label = String(body?.label || "").trim();
  const target = normalizeUrl(body?.target_url);
  if (!label) return { error: "A label is required.", status: 400 };
  if (!target) return { error: "Enter a valid web address (http or https).", status: 400 };

  // Retry on the rare slug collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    const { data, error } = await supa
      .from("qr_codes")
      .insert({ code, label, target_url: target, created_by_id: user.id })
      .select("id, code, label, target_url, is_active, scan_count, created_by_id, created_at, updated_at")
      .single();
    if (!error) return { code: (await withCreators(supa, [data]))[0] };
    if (error.code !== "23505") return { error: error.message, status: 500 }; // not a unique violation
  }
  return { error: "Could not generate a unique code, please retry.", status: 500 };
}

async function updateCode(supa, body) {
  const id = String(body?.id || "");
  if (!id) return { error: "id is required.", status: 400 };
  const patch = { updated_at: new Date().toISOString() };
  if (body.label != null) {
    const label = String(body.label).trim();
    if (!label) return { error: "Label cannot be empty.", status: 400 };
    patch.label = label;
  }
  if (body.target_url != null) {
    const target = normalizeUrl(body.target_url);
    if (!target) return { error: "Enter a valid web address (http or https).", status: 400 };
    patch.target_url = target;
  }
  const { data, error } = await supa
    .from("qr_codes").update(patch).eq("id", id)
    .select("id, code, label, target_url, is_active, scan_count, created_by_id, created_at, updated_at").single();
  if (error) return { error: error.message, status: 500 };
  return { code: (await withCreators(supa, [data]))[0] };
}

async function toggleCode(supa, body) {
  const id = String(body?.id || "");
  if (!id) return { error: "id is required.", status: 400 };
  const { data, error } = await supa
    .from("qr_codes").update({ is_active: !!body.is_active, updated_at: new Date().toISOString() }).eq("id", id)
    .select("id, code, label, target_url, is_active, scan_count, created_by_id, created_at, updated_at").single();
  if (error) return { error: error.message, status: 500 };
  return { code: (await withCreators(supa, [data]))[0] };
}

async function deleteCode(supa, body) {
  const id = String(body?.id || "");
  if (!id) return { error: "id is required.", status: 400 };
  const { error } = await supa.from("qr_codes").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }

  const user = await getSessionUser(supa, event).catch(() => null);
  if (!user) return respond(401, { error: "unauthorized" });
  if ((ROLE_LEVEL[user.role] ?? -1) < MIN_LEVEL) return respond(403, { error: "QR codes are limited to GM and above." });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    if (action === "list") return unwrap(await listCodes(supa));
    if (action === "create") return unwrap(await createCode(supa, user, body));
    if (action === "update") return unwrap(await updateCode(supa, body));
    if (action === "toggle") return unwrap(await toggleCode(supa, body));
    if (action === "delete") return unwrap(await deleteCode(supa, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
