// reports — admin API for /admin/reports. Lists report definitions with their
// recent run history, edits a definition (enabled / recipients / cron / etc.),
// and triggers a "send test" (to the current admin only) or a real "run now".
// Admin-only; the underlying tables are also RLS-guarded.

import { admin, envConfigured } from "./_lib/reports/core.js";
import { runReportByKey } from "./_lib/reports/dispatch.js";

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles").select("id, email, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const roleOf = (u) => String(u?.role || "").toLowerCase();

// Only fields the UI may change on a definition.
const EDITABLE = ["name", "description", "enabled", "cron", "timezone", "recipients", "send_when_empty"];

async function listDefinitions(supa) {
  const { data: defs } = await supa.from("report_definitions").select("*").order("key");
  // Most-recent run per report for the list view.
  const { data: runs } = await supa.from("report_runs")
    .select("report_key, status, created_at, recipient_count, row_count, error")
    .order("created_at", { ascending: false }).limit(300);
  const latest = new Map();
  for (const r of runs || []) if (!latest.has(r.report_key)) latest.set(r.report_key, r);
  return {
    definitions: (defs || []).map((d) => ({ ...d, latest_run: latest.get(d.key) || null })),
  };
}

async function listRuns(supa, key) {
  const { data } = await supa.from("report_runs")
    .select("id, report_key, status, started_at, completed_at, recipient_count, row_count, error, payload_summary, window_start")
    .eq("report_key", key).order("created_at", { ascending: false }).limit(30);
  return { runs: data || [] };
}

async function updateDefinition(supa, user, body) {
  const key = String(body?.key || "").trim();
  if (!key) return { error: "key is required", status: 400 };
  const patch = {};
  for (const f of EDITABLE) if (f in (body || {})) patch[f] = body[f];
  if (!Object.keys(patch).length) return { error: "nothing to update", status: 400 };
  if ("recipients" in patch && !Array.isArray(patch.recipients)) return { error: "recipients must be an array", status: 400 };
  patch.updated_at = new Date().toISOString();
  patch.updated_by = user.id;
  const { data, error } = await supa.from("report_definitions").update(patch).eq("key", key).select().maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "report not found", status: 404 };
  return { ok: true, definition: data };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (!envConfigured()) return respond(500, { error: "Supabase env not configured" });
  const supa = admin();

  let user;
  try { user = await sessionUser(supa, event); } catch (e) { return respond(500, { error: e?.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  if (roleOf(user) !== "admin") return respond(403, { error: "Admins only." });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";

  try {
    if (event.httpMethod === "GET") {
      if (action === "list") return respond(200, { ok: true, ...(await listDefinitions(supa)) });
      if (action === "runs") return respond(200, { ok: true, ...(await listRuns(supa, params.key)) });
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "update") {
        const out = await updateDefinition(supa, user, body);
        return out.error ? respond(out.status || 500, { error: out.error }) : respond(200, out);
      }
      if (action === "send-test") {
        // Sends only to the current admin, regardless of the report's recipients.
        const out = await runReportByKey(supa, String(body?.key || ""), { testTo: user.email });
        if (out.error) return respond(out.status || 500, { error: out.error });
        return respond(200, { ok: true, run: out, sent_to: user.email });
      }
      if (action === "run-now") {
        // Real run: sends to the report's configured recipients now.
        const out = await runReportByKey(supa, String(body?.key || ""));
        if (out.error) return respond(out.status || 500, { error: out.error });
        return respond(200, { ok: true, run: out });
      }
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e?.message || "server error" });
  }
};
