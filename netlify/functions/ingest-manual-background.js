// ingest-manual-background — heavy PDF indexing as a Netlify *background*
// function. The "-background" filename suffix tells Netlify to run it async
// with a 15-minute budget (vs ~10s for a normal function), so large manuals
// (25–100 MB) no longer 502 on a synchronous timeout.
//
// Background functions return 202 immediately and their body is discarded, so
// progress/results are written to the doc_versions row (index_status, …) which
// the client polls. Auth + role are still enforced before any work runs.
//
//   POST ?action=ingest  { doc_version_id }   (caller must be RVP-and-up/admin)

import { createClient } from "@supabase/supabase-js";
import { runIngest } from "./_lib/manual-ingest.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MANAGE_ROLES = new Set(["rvp", "vp", "coo", "admin"]); // mirrors manual_can_manage()

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("ingest-manual env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles").select("id, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only." };

  const supa = admin();
  const user = await getSessionUser(supa, event).catch(() => null);
  if (!user) return { statusCode: 401, body: "unauthorized" };
  if (!MANAGE_ROLES.has(String(user.role))) return { statusCode: 403, body: "forbidden" };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const docVersionId = body?.doc_version_id;

  try {
    await runIngest(supa, docVersionId);
  } catch (e) {
    // Best-effort: surface a crash to the poller instead of leaving it hung.
    if (docVersionId) {
      await supa.from("doc_versions")
        .update({ index_status: "error", index_error: e?.message || "indexing crashed" })
        .eq("id", docVersionId)
        .catch(() => {});
    }
  }
  // Body is ignored for background functions; status is informational only.
  return { statusCode: 202, body: "" };
};
