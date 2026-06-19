// netlify/functions/qr-redirect.js
//
// Anonymous public endpoint that powers a dynamic QR code. The printed QR
// encodes  https://<host>/q/<code>  ; netlify.toml rewrites that to this
// function with ?code=<code>. We look up the (active) code and 302 to its
// current target_url — so the destination can be edited later without
// reprinting the QR. Misses get a tiny self-contained HTML page (no SPA load).
//
// Service role only; this table is RLS-locked and never touched by anon
// PostgREST. No auth — the code in the URL is the only credential.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function notFound(message) {
  return {
    statusCode: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR code not found</title>
<div style="font-family:system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1.5rem;text-align:center;color:#27272a">
  <div style="font-size:2.5rem">🔗</div>
  <h1 style="font-size:1.25rem;margin:.75rem 0 .25rem">This code isn’t active</h1>
  <p style="color:#71717a;font-size:.95rem;line-height:1.5">${message || "The QR code you scanned is no longer pointing anywhere. Ask the person who shared it to re-activate or update it."}</p>
</div>`,
  };
}

export const handler = async (event) => {
  const code = (event.queryStringParameters?.code || "").trim();
  if (!code) return notFound("No code was provided.");
  if (!SUPABASE_URL || !SERVICE_KEY) return notFound("Service unavailable.");

  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: row } = await supa
    .from("qr_codes").select("id, target_url, is_active").eq("code", code).maybeSingle();

  if (!row || !row.is_active || !row.target_url) {
    return notFound(row && !row.is_active ? "This QR code has been deactivated." : undefined);
  }

  // Count the scan, but never block the redirect on it.
  supa.rpc("increment_qr_scan", { p_id: row.id }).then(
    () => {},
    async () => {
      // Fallback if the RPC isn't present: best-effort read-modify-write.
      const { data: cur } = await supa.from("qr_codes").select("scan_count").eq("id", row.id).maybeSingle();
      await supa.from("qr_codes").update({ scan_count: (cur?.scan_count || 0) + 1 }).eq("id", row.id).then(() => {}, () => {});
    },
  );

  return {
    statusCode: 302,
    headers: {
      Location: row.target_url,
      // A dynamic QR must never be cached by the browser/CDN, or an edit to
      // the destination wouldn't take effect for someone who scanned before.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
    body: "",
  };
};
