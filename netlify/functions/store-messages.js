// netlify/functions/store-messages.js
//
// Service-role backend for the home-screen message board. GM and above post
// announcements scoped to their stores, targeted at chosen store positions
// (audience_roles). Recipients (matching position + store) see them on the
// dashboard, open attachments, and tick "I've read this". All actions are
// authed (bearer JWT) and gated server-side; the tables are RLS-locked.
//
// Actions (?action=):
//   list      GET                     -> { messages: [...] }       (visible to caller)
//   create    POST { title, body, audienceRoles?, storeNumbers?, attachments?, isPinned? } (GM+)
//   markRead  POST { id }             -> { ok }
//   readers   GET  ?id=               -> { readers, recipientCount } (author/admin)
//   delete    POST { id }             -> { ok }                     (author/admin)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "store-messages";

const ROLE_LEVEL = {
  shift_manager: 10, first_assistant_manager: 10, associate_manager: 10,
  crew_leader: 10, crew_member: 10, carhop: 10,
  gm: 20, do: 30, sdo: 40, rvp: 50, vp: 60, coo: 70, admin: 100,
};
const POST_MIN_LEVEL = ROLE_LEVEL.gm; // GM and above can post
// Positions a message can be addressed to (store roles + GM).
const AUDIENCE_ROLES = new Set([
  "crew_member", "carhop", "crew_leader", "associate_manager",
  "first_assistant_manager", "shift_manager", "gm",
]);
const DEFAULT_AUDIENCE = ["crew_leader", "associate_manager", "first_assistant_manager", "shift_manager", "gm"];

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("store-messages env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
const lvl = (role) => ROLE_LEVEL[String(role || "").toLowerCase()] ?? null;
const displayName = (p) => p?.preferred_name || p?.full_name || p?.email || "Someone";

async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active, primary_store_id")
    .eq("id", userRes.user.id).single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

// The store number a profile belongs to (via primary_store_id).
async function callerStoreNumber(supa, profile) {
  if (!profile.primary_store_id) return null;
  const { data } = await supa.from("stores").select("number").eq("id", profile.primary_store_id).maybeSingle();
  return data ? String(data.number) : null;
}

// Store numbers a GM+ oversees (for scope validation + manager visibility).
async function visibleStoreNumbers(supa, userId) {
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: userId });
  const ids = (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data: rows } = await supa.from("stores").select("number").in("id", ids);
  return [...new Set((rows ?? []).map((s) => String(s.number)))];
}

const overlaps = (a = [], b = []) => { const set = new Set(b); return a.some((x) => set.has(x)); };

async function listMessages(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  const myStore = await callerStoreNumber(supa, profile);
  const isManager = (lvl(role) ?? 0) >= POST_MIN_LEVEL;
  const myStores = isManager ? await visibleStoreNumbers(supa, profile.id) : [];
  const isAdmin = role === "admin";

  const { data: msgs, error } = await supa
    .from("store_messages")
    .select("*")
    .eq("is_active", true)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const visible = (msgs || []).filter((m) => {
    const recipient = myStore && (m.store_numbers || []).includes(myStore) && (m.audience_roles || []).includes(role);
    const authored = m.author_id === profile.id;
    const managerScope = isManager && overlaps(m.store_numbers || [], myStores);
    return recipient || authored || managerScope || isAdmin;
  });

  const ids = visible.map((m) => m.id);
  let mineRead = new Set();
  const countById = new Map();
  if (ids.length) {
    const { data: reads } = await supa.from("store_message_reads").select("message_id, user_id").in("message_id", ids);
    for (const r of reads || []) {
      countById.set(r.message_id, (countById.get(r.message_id) || 0) + 1);
      if (r.user_id === profile.id) mineRead.add(r.message_id);
    }
  }

  const messages = visible.map((m) => ({
    ...m,
    read_count: countById.get(m.id) || 0,
    has_read: mineRead.has(m.id),
    can_manage: m.author_id === profile.id || isAdmin,
  }));
  return { messages, canPost: (lvl(role) ?? 0) >= POST_MIN_LEVEL };
}

async function createMessage(supa, profile, body) {
  const role = String(profile.role || "").toLowerCase();
  if ((lvl(role) ?? 0) < POST_MIN_LEVEL) return { error: "Only a GM and above can post.", status: 403 };

  const title = String(body?.title || "").trim();
  if (!title) return { error: "A title is required.", status: 400 };
  const text = String(body?.body || "").trim();

  // Audience — restrict to the known store positions; default to leaders+GM.
  let audience = Array.isArray(body?.audienceRoles)
    ? [...new Set(body.audienceRoles.map((r) => String(r).toLowerCase()).filter((r) => AUDIENCE_ROLES.has(r)))]
    : [];
  if (!audience.length) audience = [...DEFAULT_AUDIENCE];

  // Scope — the author's stores. Validate any provided subset is within scope.
  const myStores = await visibleStoreNumbers(supa, profile.id);
  let scope = myStores;
  if (Array.isArray(body?.storeNumbers) && body.storeNumbers.length) {
    const want = body.storeNumbers.map((s) => String(s));
    const allowed = new Set(myStores);
    scope = want.filter((s) => allowed.has(s));
  }
  if (!scope.length) {
    const my = await callerStoreNumber(supa, profile);
    if (my) scope = [my];
  }
  if (!scope.length) return { error: "Couldn't determine which stores to post to.", status: 400 };

  const { data: msg, error } = await supa
    .from("store_messages")
    .insert({
      author_id: profile.id,
      author_name: displayName(profile),
      store_numbers: scope,
      audience_roles: audience,
      title,
      body: text,
      is_pinned: !!body?.isPinned,
    })
    .select()
    .single();
  if (error) return { error: error.message, status: 500 };

  // Attachments — upload each to the public bucket, then stamp the URLs.
  const files = Array.isArray(body?.attachments) ? body.attachments.slice(0, 8) : [];
  const attached = [];
  for (const f of files) {
    if (!f?.data) continue;
    try {
      const buf = Buffer.from(f.data, "base64");
      if (buf.length > 10 * 1024 * 1024) continue; // 10 MB cap
      const ext = (f.name || "file").split(".").pop();
      const path = `${msg.id}/${Date.now()}-${attached.length}.${ext}`;
      const { error: upErr } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: f.type || "application/octet-stream", upsert: false });
      if (upErr) continue;
      const url = supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl || path;
      attached.push({ url, name: f.name || "attachment", type: f.type || "", size: buf.length });
    } catch { /* skip a bad attachment, don't fail the post */ }
  }
  if (attached.length) {
    await supa.from("store_messages").update({ attachments: attached }).eq("id", msg.id);
    msg.attachments = attached;
  }
  return { message: msg };
}

async function canSee(supa, profile, m) {
  const role = String(profile.role || "").toLowerCase();
  if (role === "admin" || m.author_id === profile.id) return true;
  const myStore = await callerStoreNumber(supa, profile);
  if (myStore && (m.store_numbers || []).includes(myStore) && (m.audience_roles || []).includes(role)) return true;
  if ((lvl(role) ?? 0) >= POST_MIN_LEVEL) {
    const myStores = await visibleStoreNumbers(supa, profile.id);
    if (overlaps(m.store_numbers || [], myStores)) return true;
  }
  return false;
}

async function markRead(supa, profile, body) {
  const id = String(body?.id || "");
  if (!id) return { error: "id is required.", status: 400 };
  const { data: m } = await supa.from("store_messages").select("*").eq("id", id).maybeSingle();
  if (!m || !m.is_active) return { error: "Message not found.", status: 404 };
  if (!(await canSee(supa, profile, m))) return { error: "Not your message.", status: 403 };
  const { error } = await supa.from("store_message_reads").upsert(
    { message_id: id, user_id: profile.id, user_name: displayName(profile), read_at: new Date().toISOString() },
    { onConflict: "message_id,user_id" },
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function getReaders(supa, profile, id) {
  if (!id) return { error: "id is required.", status: 400 };
  const { data: m } = await supa.from("store_messages").select("*").eq("id", id).maybeSingle();
  if (!m) return { error: "Message not found.", status: 404 };
  const role = String(profile.role || "").toLowerCase();
  if (m.author_id !== profile.id && role !== "admin") return { error: "Author only.", status: 403 };

  const { data: reads } = await supa.from("store_message_reads")
    .select("user_id, user_name, read_at").eq("message_id", id).order("read_at", { ascending: false });

  // Recipient denominator: active profiles whose role is in the audience and
  // whose store is one of the targeted stores.
  let recipientCount = 0;
  try {
    const { data: storeRows } = await supa.from("stores").select("id").in("number", m.store_numbers || []);
    const sids = (storeRows || []).map((s) => s.id);
    if (sids.length && (m.audience_roles || []).length) {
      const { count } = await supa.from("profiles")
        .select("id", { count: "exact", head: true })
        .in("primary_store_id", sids).in("role", m.audience_roles).eq("is_active", true);
      recipientCount = count || 0;
    }
  } catch { /* best-effort */ }

  return { readers: reads || [], recipientCount };
}

async function deleteMessage(supa, profile, body) {
  const id = String(body?.id || "");
  if (!id) return { error: "id is required.", status: 400 };
  const { data: m } = await supa.from("store_messages").select("author_id").eq("id", id).maybeSingle();
  if (!m) return { error: "Message not found.", status: 404 };
  const role = String(profile.role || "").toLowerCase();
  if (m.author_id !== profile.id && role !== "admin") return { error: "Author only.", status: 403 };
  const { error } = await supa.from("store_messages").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
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

  const user = await getSessionUser(supa, event);
  if (!user) return respond(401, { error: "Not signed in" });

  const action = (event.queryStringParameters || {}).action || "list";
  try {
    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listMessages(supa, user));
      if (action === "readers") return unwrap(await getReaders(supa, user, (event.queryStringParameters || {}).id));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "create") return unwrap(await createMessage(supa, user, body));
      if (action === "markRead") return unwrap(await markRead(supa, user, body));
      if (action === "delete") return unwrap(await deleteMessage(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
