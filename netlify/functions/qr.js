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

// Column tiers, newest schema first. Reads fall back through them so the page
// still loads before a migration runs (0177 kind/payload, then 0176 style/logo).
const COL_TIERS = [
  "id, code, label, target_url, kind, payload, is_active, scan_count, style, logo_url, created_by_id, created_at, updated_at",
  "id, code, label, target_url, is_active, scan_count, style, logo_url, created_by_id, created_at, updated_at",
  "id, code, label, target_url, is_active, scan_count, created_by_id, created_at, updated_at",
];
const isMissingCol = (err) => !!err && (err.code === "42703" || /does not exist/i.test(err.message || ""));

// Try each column tier until one isn't blocked by a missing column. `build`
// applies the row filter/ordering to a `.select(cols)` query.
async function selectTiered(supa, build) {
  let res;
  for (const cols of COL_TIERS) {
    res = await build(supa.from("qr_codes").select(cols));
    if (!res.error || !isMissingCol(res.error)) return res;
  }
  return res;
}

// Always hand the client a complete shape, even on a pre-migration path.
const normalizeRow = (r) => ({
  ...r,
  kind: r?.kind || "url",
  payload: r?.payload || {},
  style: r?.style || {},
  logo_url: r?.logo_url ?? null,
});

// ── Destination kinds → a resolved target_url the /q redirect 302s to ───────
const KINDS = new Set(["url", "email", "call", "sms"]);
const str = (x) => (x == null ? "" : String(x).slice(0, 2000));
// Keep only digits and a leading +, so tel:/sms: get a clean dialable number.
function cleanPhone(raw) {
  const s = String(raw || "").trim();
  const plus = s.trim().startsWith("+") ? "+" : "";
  const digits = s.replace(/\D/g, "");
  return digits.length >= 7 ? plus + digits : null;
}
function sanitizePayload(kind, p) {
  p = p || {};
  if (kind === "email") return { email: str(p.email), subject: str(p.subject), body: str(p.body) };
  if (kind === "call") return { phone: str(p.phone) };
  if (kind === "sms") return { phone: str(p.phone), body: str(p.body) };
  return { url: str(p.url) };
}
function resolveTarget(kind, payload, body) {
  const p = payload || {};
  if (kind === "email") {
    const email = String(p.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
    const q = [];
    if (p.subject) q.push("subject=" + encodeURIComponent(p.subject));
    if (p.body) q.push("body=" + encodeURIComponent(p.body));
    return { value: "mailto:" + email + (q.length ? "?" + q.join("&") : "") };
  }
  if (kind === "call") {
    const ph = cleanPhone(p.phone);
    if (!ph) return { error: "Enter a valid phone number." };
    return { value: "tel:" + ph };
  }
  if (kind === "sms") {
    const ph = cleanPhone(p.phone);
    if (!ph) return { error: "Enter a valid phone number." };
    return { value: "sms:" + ph + (p.body ? "?body=" + encodeURIComponent(p.body) : "") };
  }
  // url (default)
  const url = normalizeUrl(p.url ?? body?.target_url);
  if (!url) return { error: "Enter a valid web address (http or https)." };
  return { value: url };
}

// Whitelist style values so junk (or anything that could break the renderer)
// never reaches the jsonb column.
const DOT_TYPES = new Set(["square", "rounded", "dots", "classy", "extra-rounded"]);
const CORNER_TYPES = new Set(["square", "dot", "extra-rounded"]);
const SHAPES = new Set(["square", "circle"]);
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

// Re-read one row after a write, tolerating a missing newer column.
async function selectById(supa, id) {
  return selectTiered(supa, (q) => q.eq("id", id).single());
}

async function listCodes(supa) {
  const res = await selectTiered(supa, (q) => q.order("created_at", { ascending: false }));
  if (res.error) throw new Error(res.error.message);
  return { codes: await withCreators(supa, res.data || []) };
}

async function createCode(supa, user, body) {
  const label = String(body?.label || "").trim();
  if (!label) return { error: "A label is required.", status: 400 };

  // Destination: kind (url|email|call|sms) + payload → resolved target_url.
  const kind = KINDS.has(body?.kind) ? body.kind : "url";
  const resolved = resolveTarget(kind, body?.payload, body);
  if (resolved.error) return { error: resolved.error, status: 400 };

  const base = {
    label,
    kind,
    payload: sanitizePayload(kind, body?.payload),
    target_url: resolved.value,
    created_by_id: user.id,
  };
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
  // Destination edit: a kind+payload pair recomputes target_url. (A bare
  // target_url with no kind is treated as a url, for backward compatibility.)
  if (body.kind !== undefined || body.payload !== undefined) {
    const kind = KINDS.has(body.kind) ? body.kind : "url";
    const resolved = resolveTarget(kind, body.payload, body);
    if (resolved.error) return { error: resolved.error, status: 400 };
    patch.kind = kind;
    patch.payload = sanitizePayload(kind, body.payload);
    patch.target_url = resolved.value;
  } else if (body.target_url != null) {
    const resolved = resolveTarget("url", { url: body.target_url }, body);
    if (resolved.error) return { error: resolved.error, status: 400 };
    patch.kind = "url";
    patch.payload = { url: resolved.value };
    patch.target_url = resolved.value;
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
