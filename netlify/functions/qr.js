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

// Column sets — FULL includes the 0176 styling columns; BASE is the pre-0176
// fallback so reads still work if the styling migration hasn't run yet.
const FULL_COLS = "id, code, label, target_url, is_active, scan_count, style, logo_url, created_by_id, created_at, updated_at";
const BASE_COLS = "id, code, label, target_url, is_active, scan_count, created_by_id, created_at, updated_at";
const isMissingCol = (err) => !!err && (err.code === "42703" || /does not exist/i.test(err.message || ""));

// Always hand the client a complete shape, even on the BASE (pre-0176) path.
const normalizeRow = (r) => ({ ...r, style: r?.style || {}, logo_url: r?.logo_url ?? null });

// Whitelist style values so junk (or anything that could break the renderer)
// never reaches the jsonb column.
const DOT_TYPES = new Set(["square", "rounded", "dots", "classy", "extra-rounded"]);
const CORNER_TYPES = new Set(["square", "dot", "extra-rounded"]);
const SHAPES = new Set(["square", "circle"]);
const FRAME_TYPES = new Set(["none", "label", "border"]);
const FRAME_POS = new Set(["top", "bottom"]);
const isHex = (s) => typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);
function sanitizeStyle(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  if (SHAPES.has(raw.shape)) out.shape = raw.shape;
  if (DOT_TYPES.has(raw.dots)) out.dots = raw.dots;
  if (CORNER_TYPES.has(raw.corners)) out.corners = raw.corners;
  if (isHex(raw.fg)) out.fg = raw.fg;
  if (isHex(raw.bg)) out.bg = raw.bg;
  if (isHex(raw.fg2)) out.fg2 = raw.fg2;
  if (typeof raw.gradient === "boolean") out.gradient = raw.gradient;
  if (FRAME_TYPES.has(raw.frame)) out.frame = raw.frame;
  if (FRAME_POS.has(raw.framePosition)) out.framePosition = raw.framePosition;
  if (typeof raw.frameText === "string") out.frameText = raw.frameText.slice(0, 40);
  if (isHex(raw.frameColor)) out.frameColor = raw.frameColor;
  if (isHex(raw.frameTextColor)) out.frameTextColor = raw.frameTextColor;
  return out;
}
// Logo: an http(s) URL or an inline data:image up to ~200 KB. null clears it.
function validateLogo(raw) {
  if (raw === null) return { value: null };
  const s = String(raw).trim();
  if (!s) return { value: null };
  if (/^https?:\/\//i.test(s)) return { value: s.slice(0, 2048) };
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(s)) {
    if (s.length > 300_000) return { error: "Logo image is too large — use one under ~200 KB." };
    return { value: s };
  }
  return { error: "Logo must be an image upload or an http(s) URL." };
}

// Attach the creator's display name without a fragile PostgREST embed.
async function withCreators(supa, rows) {
  const ids = [...new Set(rows.map((r) => r.created_by_id).filter(Boolean))];
  let nameById = new Map();
  if (ids.length) {
    const { data: people } = await supa.from("profiles").select("id, full_name, preferred_name").in("id", ids);
    nameById = new Map((people || []).map((p) => [p.id, p.preferred_name || p.full_name || null]));
  }
  return rows.map((r) => ({ ...normalizeRow(r), created_by_name: nameById.get(r.created_by_id) || null }));
}

// Re-read one row after a write, tolerating a missing styling column.
async function selectById(supa, id) {
  let res = await supa.from("qr_codes").select(FULL_COLS).eq("id", id).single();
  if (res.error && isMissingCol(res.error)) res = await supa.from("qr_codes").select(BASE_COLS).eq("id", id).single();
  return res;
}

async function listCodes(supa) {
  let res = await supa.from("qr_codes").select(FULL_COLS).order("created_at", { ascending: false });
  if (res.error && isMissingCol(res.error)) res = await supa.from("qr_codes").select(BASE_COLS).order("created_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return { codes: await withCreators(supa, res.data || []) };
}

async function createCode(supa, user, body) {
  const label = String(body?.label || "").trim();
  const target = normalizeUrl(body?.target_url);
  if (!label) return { error: "A label is required.", status: 400 };
  if (!target) return { error: "Enter a valid web address (http or https).", status: 400 };

  // Optional styling on create (the UI customizes after, but support it here).
  const base = { label, target_url: target, created_by_id: user.id };
  if (body.style !== undefined) base.style = sanitizeStyle(body.style);
  if (body.logo_url !== undefined) {
    const lg = validateLogo(body.logo_url);
    if (lg.error) return { error: lg.error, status: 400 };
    base.logo_url = lg.value;
  }

  // Retry on the rare slug collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    const { data: ins, error } = await supa.from("qr_codes").insert({ code, ...base }).select("id").single();
    if (!error) {
      const { data, error: selErr } = await selectById(supa, ins.id);
      if (selErr) return { error: selErr.message, status: 500 };
      return { code: (await withCreators(supa, [data]))[0] };
    }
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
  if (body.style !== undefined) patch.style = sanitizeStyle(body.style);
  if (body.logo_url !== undefined) {
    const lg = validateLogo(body.logo_url);
    if (lg.error) return { error: lg.error, status: 400 };
    patch.logo_url = lg.value;
  }
  const { error } = await supa.from("qr_codes").update(patch).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  const { data, error: selErr } = await selectById(supa, id);
  if (selErr) return { error: selErr.message, status: 500 };
  return { code: (await withCreators(supa, [data]))[0] };
}

async function toggleCode(supa, body) {
  const id = String(body?.id || "");
  if (!id) return { error: "id is required.", status: 400 };
  const { error } = await supa
    .from("qr_codes").update({ is_active: !!body.is_active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  const { data, error: selErr } = await selectById(supa, id);
  if (selErr) return { error: selErr.message, status: 500 };
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
