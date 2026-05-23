// netlify/functions/personal-contacts.js
//
// Per-user private contacts. Powers the Directory page's "Mine" tab.
// Each contact is owned by the calling user; nobody else can read or
// write it. We rely on the RLS policies from migration 0073 to enforce
// that — this function just shapes the requests and validates input.
//
// Uses a user-scoped Supabase client (caller's JWT) instead of the
// service-role key so RLS naturally returns only the caller's rows
// without any extra server-side filtering.
//
// Actions:
//
//   GET  ?action=list
//     -> { contacts: PersonalContact[] }   (caller's own, newest first)
//
//   POST ?action=create
//     body: { name, phone?, email?, category?, notes?, photo_url? }
//     -> { contact: PersonalContact }
//
//   POST ?action=update
//     body: { id, ...partial }
//     -> { contact: PersonalContact }
//
//   POST ?action=delete
//     body: { id }
//     -> { ok: true }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FIELDS = "id, user_id, name, phone, email, category, notes, photo_url, created_at, updated_at";

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function getBearer(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function userClient(token) {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("personal-contacts env vars not configured");
  }
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserId(token) {
  if (!SERVICE_KEY) throw new Error("service key missing");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

// Normalize strings: trim, treat "" as null.
function s(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

export async function handler(event) {
  const token = getBearer(event);
  if (!token) return respond(401, { error: "missing token" });

  const url = new URL(event.rawUrl || `https://x${event.path}?${event.rawQuery || ""}`);
  const action = url.searchParams.get("action");
  const supa = userClient(token);

  try {
    if (event.httpMethod === "GET" && action === "list") {
      const { data, error } = await supa
        .from("personal_contacts")
        .select(FIELDS)
        .order("name", { ascending: true });
      if (error) return respond(500, { error: error.message });
      return respond(200, { contacts: data ?? [] });
    }

    if (event.httpMethod !== "POST") {
      return respond(405, { error: "method not allowed" });
    }

    const body = parseBody(event);
    if (body === null) return respond(400, { error: "invalid JSON body" });

    if (action === "create") {
      const userId = await getUserId(token);
      if (!userId) return respond(401, { error: "not signed in" });
      const name = s(body.name);
      if (!name) return respond(400, { error: "name is required" });
      const row = {
        user_id: userId,
        name,
        phone: s(body.phone),
        email: s(body.email),
        category: s(body.category),
        notes: s(body.notes),
        photo_url: s(body.photo_url),
      };
      const { data, error } = await supa
        .from("personal_contacts")
        .insert(row)
        .select(FIELDS)
        .single();
      if (error) return respond(500, { error: error.message });
      return respond(200, { contact: data });
    }

    if (action === "update") {
      const id = s(body.id);
      if (!id) return respond(400, { error: "id is required" });
      const patch = {};
      if ("name" in body) {
        const name = s(body.name);
        if (!name) return respond(400, { error: "name cannot be empty" });
        patch.name = name;
      }
      for (const k of ["phone", "email", "category", "notes", "photo_url"]) {
        if (k in body) patch[k] = s(body[k]);
      }
      if (Object.keys(patch).length === 0) {
        return respond(400, { error: "no fields to update" });
      }
      const { data, error } = await supa
        .from("personal_contacts")
        .update(patch)
        .eq("id", id)
        .select(FIELDS)
        .single();
      if (error) return respond(500, { error: error.message });
      if (!data) return respond(404, { error: "not found" });
      return respond(200, { contact: data });
    }

    if (action === "delete") {
      const id = s(body.id);
      if (!id) return respond(400, { error: "id is required" });
      const { error } = await supa
        .from("personal_contacts")
        .delete()
        .eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    return respond(400, { error: `unknown action: ${action}` });
  } catch (err) {
    return respond(500, { error: err?.message ?? "unexpected error" });
  }
}
