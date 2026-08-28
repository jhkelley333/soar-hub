// user-activity — admin/coo/vp read view of who's been active.
//
//   GET ?action=list             per-user presence: last_seen_at (from the
//                                user_activity heartbeat) + last_sign_in_at
//                                (from Supabase auth) + role/identity.
//   GET ?action=feed&limit=50    unified recent activity, a best-effort union
//                                of the existing per-feature audit logs (PAF,
//                                Cash, Workspaces, Employee Actions, View-As),
//                                actor names resolved, newest first.
//
// Read-only. Presence is written client-side (self-write RLS on user_activity);
// this function only reads, through the service role, and is gated to
// admin / coo / vp.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIEW_ROLES = new Set(["admin", "coo", "vp"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("user-activity env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "Someone";
}

async function getSessionUser(event, supa) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Pull every user's last_sign_in_at from Supabase auth (paginated).
async function fetchLastSignIns(supa) {
  const map = new Map();
  try {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
      const users = data?.users || [];
      if (error) break;
      for (const u of users) map.set(u.id, u.last_sign_in_at || null);
      if (users.length < 1000) break;
    }
  } catch (e) {
    console.log(`[user-activity] listUsers failed: ${e?.message || e}`);
  }
  return map;
}

async function listActivity(supa) {
  const [{ data: profiles }, { data: presence }, lastSignIns] = await Promise.all([
    supa.from("profiles")
      .select("id, email, full_name, preferred_name, role, is_active")
      .eq("is_active", true),
    supa.from("user_activity").select("user_id, last_seen_at, last_path"),
    fetchLastSignIns(supa),
  ]);

  const seenById = new Map((presence || []).map((r) => [r.user_id, r]));
  const rows = (profiles || []).map((p) => {
    const seen = seenById.get(p.id);
    return {
      id: p.id,
      name: displayName(p),
      email: p.email || null,
      role: p.role || null,
      last_seen_at: seen?.last_seen_at || null,
      last_path: seen?.last_path || null,
      last_sign_in_at: lastSignIns.get(p.id) || null,
    };
  });

  // Sort by most-recently-seen (then last sign-in), nulls last.
  const t = (v) => (v ? new Date(v).getTime() : -Infinity);
  rows.sort((a, b) => (t(b.last_seen_at) - t(a.last_seen_at)) || (t(b.last_sign_in_at) - t(a.last_sign_in_at)));
  return rows;
}

// Best-effort union of per-feature audit logs into a single recent feed.
async function activityFeed(supa, limit) {
  const per = Math.min(Math.max(limit, 1), 100);

  // Resolve actor display names for rows that only carry an id.
  const { data: profs } = await supa.from("profiles").select("id, email, full_name, preferred_name");
  const nameById = new Map();
  const nameByEmail = new Map();
  for (const p of profs || []) {
    nameById.set(p.id, displayName(p));
    if (p.email) nameByEmail.set(String(p.email).toLowerCase(), displayName(p));
  }
  const who = (id, email, fallback) =>
    (id && nameById.get(id)) ||
    (email && nameByEmail.get(String(email).toLowerCase())) ||
    fallback || email || "Someone";

  const sources = [
    {
      table: "paf_audit_log", source: "PAF",
      cols: "actor_id, actor_email, action, created_at",
      map: (r) => ({ actor: who(r.actor_id, r.actor_email), action: r.action, at: r.created_at }),
    },
    {
      table: "cash_audit_log", source: "Cash",
      cols: "actor_id, actor_name, scope, action, created_at",
      map: (r) => ({ actor: who(r.actor_id, null, r.actor_name), action: `${r.scope}:${r.action}`, at: r.created_at }),
    },
    {
      table: "workspace_activity_log", source: "Workspaces",
      cols: "actor_id, actor_email, target_kind, action, created_at",
      map: (r) => ({ actor: who(r.actor_id, r.actor_email), action: `${r.action} ${r.target_kind}`, at: r.created_at }),
    },
    {
      table: "employee_action_audit_log", source: "Employee Actions",
      cols: "actor_id, actor_email, request_type, action, created_at",
      map: (r) => ({ actor: who(r.actor_id, r.actor_email), action: `${r.action} ${r.request_type}`, at: r.created_at }),
    },
    {
      table: "admin_view_as_sessions", source: "View As",
      cols: "admin_id, admin_name, target_user_name, started_at",
      map: (r) => ({ actor: who(r.admin_id, null, r.admin_name), action: `viewed as ${r.target_user_name || "a user"}`, at: r.started_at }),
      order: "started_at",
    },
  ];

  const results = await Promise.all(sources.map(async (s) => {
    try {
      const { data, error } = await supa.from(s.table)
        .select(s.cols).order(s.order || "created_at", { ascending: false }).limit(per);
      if (error) return [];
      return (data || []).map((r) => ({ source: s.source, ...s.map(r) }));
    } catch {
      return []; // table shape drift / not present → skip this source
    }
  }));

  const merged = results.flat().filter((r) => r.at);
  merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return merged.slice(0, per);
}

export const handler = async (event) => {
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }

  const user = await getSessionUser(event, supa);
  if (!user) return respond(401, { error: "Not signed in." });
  if (!VIEW_ROLES.has(String(user.role).toLowerCase())) {
    return respond(403, { error: "You don't have access to user activity." });
  }

  const action = event.queryStringParameters?.action || "list";
  try {
    if (action === "list") {
      return respond(200, { users: await listActivity(supa) });
    }
    if (action === "feed") {
      const limit = parseInt(event.queryStringParameters?.limit, 10) || 50;
      return respond(200, { feed: await activityFeed(supa, limit) });
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.log(`[user-activity] ${action} failed: ${e?.message || e}`);
    return respond(500, { error: e?.message || "Request failed" });
  }
};
