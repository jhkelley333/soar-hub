// COO map backend — cross-brand executive view.
//   POST ?action=geocode-apricus  (admin) — batch-geocode Apricus stores whose
//                                  latitude is null; time-budgeted + throttled,
//                                  loop until { done: true }.
// Phase 4 adds the read action (get_coo_map_stores) for the map itself.

import { createClient } from "@supabase/supabase-js";
import { geocodeAddress, geocodeConfigured } from "./_lib/geocode.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("coo-map env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
async function getSessionUser(supa, event) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// AL stores with no ZIP on import — surface them for a manual eyeball.
const AL_FLAG = new Set(["0039", "0040", "0041"]);

// Batch-geocode Apricus stores with no coordinates yet. Never geocodes on map
// load — results are cached back to stores.latitude/longitude. Works within a
// time budget so it stays under the function timeout; returns `remaining` so
// the caller can loop.
async function geocodeApricus(supa) {
  if (!geocodeConfigured()) return { error: "Geocoding not configured (GOOGLE_GEOCODING_API_KEY).", status: 500 };

  const { data: company } = await supa.from("companies").select("id").eq("slug", "apricus").maybeSingle();
  if (!company) return { error: "Apricus company not found — run migration 0248.", status: 400 };

  const { data: stores, error } = await supa
    .from("stores")
    .select("id, number, name, address, state, latitude")
    .eq("company_id", company.id)
    .is("latitude", null)
    .limit(500);
  if (error) return { error: error.message, status: 500 };

  const started = Date.now();
  const BUDGET_MS = 8000;
  let geocoded = 0;
  const failed = [];
  const flagged = [];
  let processed = 0;

  for (const s of stores || []) {
    if (Date.now() - started > BUDGET_MS) break;
    processed++;
    const addr = (s.address || "").trim();
    if (!addr) { failed.push({ number: s.number, name: s.name, error: "no address" }); continue; }
    const geo = await geocodeAddress(addr);
    if (geo.error) { failed.push({ number: s.number, name: s.name, error: geo.error }); await sleep(120); continue; }
    const { error: upErr } = await supa.from("stores").update({ latitude: geo.lat, longitude: geo.lng }).eq("id", s.id);
    if (upErr) { failed.push({ number: s.number, name: s.name, error: upErr.message }); continue; }
    geocoded++;
    if (AL_FLAG.has(String(s.number))) flagged.push({ number: s.number, name: s.name, lat: geo.lat, lng: geo.lng });
    await sleep(120); // throttle for quota
  }

  const remaining = Math.max(0, (stores?.length || 0) - processed);
  return { geocoded, failed, flagged, remaining, done: remaining === 0 };
}

export const handler = async (event) => {
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getSessionUser(supa, event);
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "";

  if (event.httpMethod === "POST" && action === "geocode-apricus") {
    if (String(user.role).toLowerCase() !== "admin") {
      return respond(403, { error: "Only admins can run the Apricus geocode." });
    }
    const out = await geocodeApricus(supa);
    return out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out });
  }

  return respond(400, { error: `Unknown action: ${action}` });
};
