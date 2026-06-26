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

// Force an absolute destination. Recognized schemes (web + app handoffs) pass
// through; a bare host/path is prefixed with https so the 302 is never relative.
function absoluteLocation(target) {
  const t = String(target || "").trim();
  if (/^(https?|mailto|tel|sms):/i.test(t)) return t;
  return "https://" + t.replace(/^\/+/, "");
}

// Pull the code out of the request. The /q/* rewrite is supposed to pass it as
// ?code=:splat, but Netlify's :splat interpolation INSIDE a query string on a
// function rewrite is unreliable and frequently arrives empty. So we prefer the
// query param when present, then fall back to parsing it out of the original
// path / URL (/q/<code>) — which the proxy rewrite preserves on event.path and
// event.rawUrl. This makes the redirect robust regardless of the toml quirk.
function extractCode(event) {
  const fromQuery = (event.queryStringParameters?.code || "").trim();
  if (fromQuery && fromQuery !== ":splat") return fromQuery;
  const sources = [event.path, event.rawUrl, event.headers?.["x-nf-original-pathname"]];
  for (const src of sources) {
    if (!src) continue;
    const m = /\/q\/([^/?#]+)/i.exec(String(src));
    if (m && m[1]) {
      try { return decodeURIComponent(m[1]).trim(); } catch { return m[1].trim(); }
    }
  }
  return "";
}

function notFound(message) {
  return {
    statusCode: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR code not found</title>
<div style="font-family:system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1.5rem;text-align:center;color:#27272a">
  <div style="font-size:2.5rem">🔗</div>
  <h1 style="font-size:1.25rem;margin:.75rem 0 .25rem">This QR code isn’t available</h1>
  <p style="color:#71717a;font-size:.95rem;line-height:1.5">${message || "The QR code you scanned is no longer pointing anywhere. Ask the person who shared it to re-activate or update it."}</p>
</div>`,
  };
}

export const handler = async (event) => {
  const code = extractCode(event);
  if (!code) return notFound("No code was provided.");
  if (!SUPABASE_URL || !SERVICE_KEY) return notFound("Service unavailable.");

  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: row } = await supa
    .from("qr_codes").select("id, target_url, is_active").eq("code", code).maybeSingle();

  // Distinct messages so a scan tells us exactly which condition tripped,
  // instead of one catch-all "isn't active".
  if (!row) return notFound("We couldn’t find this code. Ask whoever shared it for an updated link.");
  if (!row.is_active) return notFound("This QR code has been deactivated.");
  if (!row.target_url) return notFound("This QR code doesn’t have a destination set yet.");

  // Count the scan. We must AWAIT this: a serverless function freezes its
  // container the instant the handler returns, so a fire-and-forget write gets
  // dropped and the count never moves. A single UPDATE is a couple of ms — well
  // worth it to count reliably. Counting must still never break the redirect,
  // so any failure is swallowed.
  try {
    // PostgREST surfaces a missing-RPC as a resolved { error }, not a throw, so
    // branch on error (not catch) to reach the read-modify-write fallback.
    const { error } = await supa.rpc("increment_qr_scan", { p_id: row.id });
    if (error) {
      const { data: cur } = await supa.from("qr_codes").select("scan_count").eq("id", row.id).maybeSingle();
      await supa.from("qr_codes").update({ scan_count: (cur?.scan_count || 0) + 1 }).eq("id", row.id);
    }
  } catch {
    /* never block the redirect on counting */
  }

  return {
    statusCode: 302,
    headers: {
      // Guarantee an ABSOLUTE Location. A target stored without a scheme (a
      // bare "example.com") would otherwise be treated as relative to /q/<code>
      // and loop back into this function as a bogus code ("isn't active"). Known
      // app-handoff schemes (tel:/mailto:/sms:) and http(s) pass through as-is;
      // anything else is forced to https.
      Location: absoluteLocation(row.target_url),
      // A dynamic QR must never be cached by the browser/CDN, or an edit to
      // the destination wouldn't take effect for someone who scanned before.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
    body: "",
  };
};
