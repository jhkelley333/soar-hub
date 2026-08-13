// Per-store username/password vault. Store operations logins (alarm, vendor
// portals, POS, etc.), scoped to GM and above for stores they can see.
// Passwords are encrypted at rest with AES-256-GCM (key derived from VAULT_KEY);
// the list never returns a password — a plaintext value is only returned on an
// explicit per-entry `reveal`.
//
//   GET  ?action=list&store=<number>   -> entries (no passwords)
//   GET  ?action=reveal&id=<id>        -> { password } for one entry
//   POST ?action=save   {store_number, label, username, password, url, notes, id?}
//   POST ?action=delete {id}
//
// Service-role gatekeeper: RLS on store_vault_entries, no policies.
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAULT_KEY = process.env.VAULT_KEY || process.env.VAULT_SECRET || "";

const VAULT_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]); // GM and above
const ORG_WIDE = new Set(["admin", "vp", "coo"]);

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
const displayName = (p) => (p ? p.preferred_name || p.full_name || p.email || null : null);

async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  const { data: { user } = {} } = await supa.auth.getUser(token);
  if (!user) return null;
  const { data: p } = await supa.from("profiles").select("id, role, is_active, full_name, preferred_name, email").eq("id", user.id).maybeSingle();
  return p && p.is_active ? { id: p.id, role: String(p.role || "").toLowerCase(), name: displayName(p) } : null;
}

async function visibleStoreNumbers(supa, user) {
  if (ORG_WIDE.has(user.role)) return null; // all
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean);
  if (!ids.length) return new Set();
  const { data } = await supa.from("stores").select("number").in("id", ids);
  return new Set((data ?? []).map((s) => String(s.number)));
}
const inScope = (scope, number) => scope == null || scope.has(String(number));

// ── AES-256-GCM. Key = sha256(VAULT_KEY). Payload = base64(iv[12] | tag[16] | ct).
const keyBuf = () => createHash("sha256").update(String(VAULT_KEY)).digest();
function encrypt(plain) {
  if (plain == null || plain === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuf(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}
function decrypt(payload) {
  if (!payload) return "";
  const buf = Buffer.from(String(payload), "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", keyBuf(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

const clean = (v, n = 500) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

async function nameFor(supa, id) {
  if (!id) return null;
  const { data } = await supa.from("profiles").select("full_name, preferred_name, email").eq("id", id).maybeSingle();
  return displayName(data);
}

export const handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "store-vault env vars not configured" });
    const supa = admin();
    const user = await sessionUser(supa, event);
    if (!user) return respond(401, { error: "unauthorized" });
    if (!VAULT_ROLES.has(user.role)) return respond(403, { error: "The vault is for GM and above." });

    const params = event.queryStringParameters || {};
    const action = params.action || "list";
    const scope = await visibleStoreNumbers(supa, user);

    if (event.httpMethod === "GET" && action === "list") {
      const storeNumber = String(params.store || "").trim();
      if (!storeNumber) return respond(400, { error: "store is required" });
      if (!inScope(scope, storeNumber)) return respond(403, { error: "This store isn't in your scope." });
      const { data, error } = await supa.from("store_vault_entries").select("*").eq("store_number", storeNumber).order("label", { ascending: true });
      if (error) {
        if (/store_vault_entries/.test(error.message)) return respond(500, { error: "Run migration 0287 first (store_vault_entries is missing)." });
        return respond(500, { error: error.message });
      }
      const ids = [...new Set((data || []).map((r) => r.updated_by).filter(Boolean))];
      const names = new Map();
      if (ids.length) {
        const { data: profs } = await supa.from("profiles").select("id, full_name, preferred_name, email").in("id", ids);
        for (const p of profs || []) names.set(p.id, displayName(p));
      }
      const rows = (data || []).map((r) => ({
        id: r.id, label: r.label, username: r.username, url: r.url, notes: r.notes,
        has_password: !!r.password_enc,
        updated_by_name: r.updated_by ? names.get(r.updated_by) ?? null : null, updated_at: r.updated_at,
      }));
      return respond(200, { rows, key_configured: !!VAULT_KEY });
    }

    if (event.httpMethod === "GET" && action === "reveal") {
      if (!VAULT_KEY) return respond(500, { error: "Vault encryption key isn't configured (VAULT_KEY)." });
      const id = String(params.id || "").trim();
      if (!id) return respond(400, { error: "id is required" });
      const { data: r } = await supa.from("store_vault_entries").select("store_number, password_enc").eq("id", id).maybeSingle();
      if (!r) return respond(404, { error: "Not found." });
      if (!inScope(scope, r.store_number)) return respond(403, { error: "This store isn't in your scope." });
      try {
        return respond(200, { password: decrypt(r.password_enc) });
      } catch {
        return respond(500, { error: "Couldn't decrypt (wrong VAULT_KEY?)." });
      }
    }

    if (event.httpMethod !== "POST") return respond(405, { error: "method not allowed" });
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

    if (action === "save") {
      const storeNumber = clean(body.store_number, 20);
      const label = clean(body.label, 200);
      if (!storeNumber) return respond(400, { error: "store_number is required" });
      if (!label) return respond(400, { error: "A label is required." });
      if (!inScope(scope, storeNumber)) return respond(403, { error: "This store isn't in your scope." });
      const { data: store } = await supa.from("stores").select("id, number").eq("number", storeNumber).or("brand.eq.sonic,brand.is.null").maybeSingle();

      const patch = {
        store_number: storeNumber, store_id: store?.id ?? null, label,
        username: clean(body.username, 200), url: clean(body.url, 500), notes: clean(body.notes, 2000),
        updated_by: user.id, updated_at: new Date().toISOString(),
      };
      // password: present key → set (encrypt non-empty, else null); absent → keep existing.
      if (Object.prototype.hasOwnProperty.call(body, "password")) {
        if (!VAULT_KEY) return respond(500, { error: "Vault encryption key isn't configured (VAULT_KEY)." });
        patch.password_enc = encrypt(clean(body.password, 500));
      }
      const id = clean(body.id, 60);
      if (id) {
        const { data: existing } = await supa.from("store_vault_entries").select("store_number").eq("id", id).maybeSingle();
        if (!existing) return respond(404, { error: "Not found." });
        if (!inScope(scope, existing.store_number)) return respond(403, { error: "This store isn't in your scope." });
        const { error } = await supa.from("store_vault_entries").update(patch).eq("id", id);
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true, id });
      }
      const { data, error } = await supa.from("store_vault_entries").insert({ ...patch, created_at: new Date().toISOString() }).select("id").maybeSingle();
      if (error) {
        if (/store_vault_entries/.test(error.message)) return respond(500, { error: "Run migration 0287 first (store_vault_entries is missing)." });
        return respond(500, { error: error.message });
      }
      return respond(200, { ok: true, id: data?.id });
    }

    if (action === "delete") {
      const id = clean(body.id, 60);
      if (!id) return respond(400, { error: "id is required" });
      const { data: r } = await supa.from("store_vault_entries").select("store_number").eq("id", id).maybeSingle();
      if (!r) return respond(404, { error: "Not found." });
      if (!inScope(scope, r.store_number)) return respond(403, { error: "This store isn't in your scope." });
      const { error } = await supa.from("store_vault_entries").delete().eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("[store-vault]", e?.message || e);
    return respond(500, { error: e?.message || "server error" });
  }
};
