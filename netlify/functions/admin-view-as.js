// Admin "View As" — read-only debugging mode. An admin picks another user
// and sees the app the way that user would (starting with My CAPs / My
// Assignments / Sign-off Queue — see workspaces.js / workspace-caps.js /
// workspace-submissions.js for where the X-View-As-User-Id header is
// actually honored). No writes are possible while a session is active:
// those functions hard-reject any POST that carries the header, regardless
// of what the UI shows, so this can't be used to act on someone's behalf.
//
//   POST ?action=start  { targetUserId } — admin only. Returns the session
//                                          + a snapshot of the target's
//                                          identity for the client to show
//                                          in the banner.
//   POST ?action=end    { sessionId }    — stamps ended_at. Best-effort; the
//                                          client also just stops sending
//                                          the header, this is for the
//                                          audit trail.
//   GET  ?action=history                — the caller's own recent sessions
//                                          (admin only), for a quick "who
//                                          did I view as recently" list.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("admin-view-as env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function sanitize(v, max) {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}
function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "Someone";
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

async function startSession(supa, user, body) {
  if (String(user.role).toLowerCase() !== "admin") return { error: "Admin only.", status: 403 };
  const targetId = sanitize(body?.targetUserId, 64);
  if (!targetId) return { error: "targetUserId is required.", status: 400 };
  if (targetId === user.id) return { error: "You're already viewing your own account.", status: 400 };
  const { data: target } = await supa
    .from("profiles").select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", targetId).maybeSingle();
  if (!target || target.is_active === false) return { error: "That user wasn't found or is inactive.", status: 404 };

  const { data, error } = await supa.from("admin_view_as_sessions").insert({
    admin_id: user.id,
    admin_name: displayName(user),
    target_user_id: target.id,
    target_user_name: displayName(target),
  }).select("*").single();
  if (error) return { error: error.message, status: 500 };

  return {
    ok: true,
    session_id: data.id,
    target: { id: target.id, name: displayName(target), role: target.role },
  };
}

async function endSession(supa, user, body) {
  const sessionId = sanitize(body?.sessionId, 64);
  if (!sessionId) return { ok: true }; // nothing to close — fine
  // Only the admin who started it can close it (defense in depth; the
  // client only ever closes its own session anyway).
  await supa.from("admin_view_as_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId).eq("admin_id", user.id).is("ended_at", null);
  return { ok: true };
}

async function history(supa, user) {
  if (String(user.role).toLowerCase() !== "admin") return { error: "Admin only.", status: 403 };
  const { data } = await supa
    .from("admin_view_as_sessions")
    .select("id, target_user_id, target_user_name, started_at, ended_at")
    .eq("admin_id", user.id)
    .order("started_at", { ascending: false })
    .limit(20);
  return { ok: true, sessions: data || [] };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  const user = await getSessionUser(event);
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "history";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    let result;
    if (event.httpMethod === "GET" && action === "history") result = await history(supa, user);
    else if (action === "start") result = await startSession(supa, user, body);
    else if (action === "end") result = await endSession(supa, user, body);
    else return respond(400, { error: `Unknown action: ${action}` });

    if (result?.error) return respond(result.status || 500, { error: result.error });
    return respond(200, result);
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
