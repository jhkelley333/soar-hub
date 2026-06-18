// ingest-manual — Manual & Guide Search.
//
// (Built as a Netlify Function, not a Supabase Edge Function: this repo has no
// supabase/functions/ — all backend is Node Netlify Functions.)
//
// Indexing (download → parse → chunk) now runs entirely in the browser — see
// src/modules/manuals/{pdfText,chunker}.ts and ingestVersion() — because
// parsing 25–100 MB manuals blew past a function's time/memory budget (502).
// Writes go straight to manual_chunks/doc_versions under RLS. This function is
// left only for activation, which is a fast, atomic RPC.
//
//   ?action=activate { doc_version_id }  flip this version live (others off),
//                                          atomically, via activate_doc_version().

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MANAGE_ROLES = new Set(["rvp", "vp", "coo", "admin"]); // mirrors manual_can_manage()

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("ingest-manual env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
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
    .from("profiles").select("id, email, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Flip a version live (others for that manual go inactive) — atomic in the RPC.
async function activate(supa, docVersionId) {
  if (!docVersionId) return { error: "doc_version_id is required.", status: 400 };
  const { error } = await supa.rpc("activate_doc_version", { p_version_id: docVersionId });
  if (error) return { error: error.message, status: 500 };
  return { ok: true, doc_version_id: docVersionId, active: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only." });

  let user;
  try { user = await getSessionUser(event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  if (!MANAGE_ROLES.has(String(user.role))) return respond(403, { error: "Manuals are managed by RVP and above." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const action = (event.queryStringParameters || {}).action || "activate";

  try {
    const supa = admin();
    if (action === "activate") return unwrap(await activate(supa, body?.doc_version_id));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};

function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}
