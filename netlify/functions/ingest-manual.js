// ingest-manual — Manual & Guide Search, Phase 2.
//
// (Built as a Netlify Function, not a Supabase Edge Function: this repo has no
// supabase/functions/ — all backend is Node Netlify Functions.)
//
// Actions (POST, service-role; caller must be RVP-and-up or admin):
//   ?action=ingest   { doc_version_id }  download the PDF, chunk by section,
//                                          replace that version's chunks, stamp
//                                          indexed_at. Leaves embedding NULL.
//   ?action=activate { doc_version_id }  flip this version live (others off),
//                                          atomically, via activate_doc_version().
//
// Ingestion does NOT activate — activation is the explicit "old steps aside" step.

import { createClient } from "@supabase/supabase-js";
import { PDFParse } from "pdf-parse";
import { chunkSections } from "./_lib/manual-chunker.js";

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

// Chunk one version: download → extract text → split → replace chunks.
async function ingest(supa, docVersionId) {
  if (!docVersionId) return { error: "doc_version_id is required.", status: 400 };
  const { data: ver, error: vErr } = await supa
    .from("doc_versions").select("id, manual_id, storage_path").eq("id", docVersionId).maybeSingle();
  if (vErr) return { error: vErr.message, status: 500 };
  if (!ver) return { error: "doc_version not found.", status: 404 };

  const { data: file, error: dErr } = await supa.storage.from("manuals").download(ver.storage_path);
  if (dErr || !file) return { error: `Couldn't download source file: ${dErr?.message || "missing"}`, status: 502 };

  let text;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buf });
    try {
      text = (await parser.getText()).text || "";
    } finally {
      await parser.destroy?.();
    }
  } catch (e) {
    return { error: `PDF parse failed: ${e.message}`, status: 422 };
  }

  const sections = chunkSections(text);
  if (!sections.length) return { error: "No sections detected in the document.", status: 422 };

  // Idempotent: replace this version's chunks rather than appending.
  const { error: delErr } = await supa.from("manual_chunks").delete().eq("doc_version_id", docVersionId);
  if (delErr) return { error: delErr.message, status: 500 };

  const rows = sections.map((s) => ({
    manual_id: ver.manual_id,
    doc_version_id: docVersionId,
    section_path: s.section_path,
    heading: s.heading,
    content: s.content,
    ordinal: s.ordinal,
    // embedding intentionally left NULL (reserved for pgvector).
  }));
  // Insert in chunks of 500 to stay well under payload limits.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supa.from("manual_chunks").insert(rows.slice(i, i + 500));
    if (error) return { error: error.message, status: 500 };
  }

  await supa.from("doc_versions").update({ indexed_at: new Date().toISOString() }).eq("id", docVersionId);
  return { ok: true, doc_version_id: docVersionId, chunks: rows.length };
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
  const action = (event.queryStringParameters || {}).action || "ingest";

  try {
    const supa = admin();
    if (action === "ingest") return unwrap(await ingest(supa, body?.doc_version_id));
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
