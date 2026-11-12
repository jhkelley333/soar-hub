// nws-zones-refresh — admin POST. Maps each active store (with lat/lng) to its
// NWS forecast zone + county zone via /points/{lat},{lon}, then upserts into
// store_nws_zones. The poller auto-seeds up to 10 missing stores per run; call
// this endpoint to do a full initial seed or to refresh stale zone data.
//
// Query params:
//   only_missing=0  — refresh ALL stores even if they already have zone data
//   limit=N         — cap stores processed in one call (default 20, max 100)

import { createClient } from "@supabase/supabase-js";
import { nwsFetch, NWS_BASE, parseZoneCode } from "./_lib/nwsAlerts.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(code, body) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });
  const supa = admin();

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader.startsWith("Bearer ")) return respond(401, { error: "Not signed in." });
  const { data: authData } = await supa.auth.getUser(authHeader.slice(7).trim());
  if (!authData?.user) return respond(401, { error: "Not signed in." });

  const { data: prof } = await supa
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (prof?.role !== "admin") return respond(403, { error: "Admin only." });

  const params = event.queryStringParameters || {};
  const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 20));
  const onlyMissing = params.only_missing !== "0";

  const { data: allStores } = await supa
    .from("stores")
    .select("id, number, latitude, longitude")
    .eq("is_active", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (!allStores?.length) return respond(200, { refreshed: 0, failed: 0, skipped: 0, note: "No stores with coordinates." });

  let candidates = allStores;
  if (onlyMissing) {
    const { data: existing } = await supa.from("store_nws_zones").select("store_id");
    const have = new Set((existing || []).map((r) => r.store_id));
    candidates = allStores.filter((s) => !have.has(s.id));
  }
  const skipped = allStores.length - candidates.length;
  candidates = candidates.slice(0, limit);

  if (!candidates.length) {
    return respond(200, {
      refreshed: 0,
      failed: 0,
      skipped,
      total_with_coords: allStores.length,
      note: "All stores already have zone data (pass only_missing=0 to force refresh).",
    });
  }

  let refreshed = 0, failed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const store = candidates[i];
    const { ok, data } = await nwsFetch(
      `${NWS_BASE}/points/${store.latitude.toFixed(4)},${store.longitude.toFixed(4)}`
    );
    if (!ok || !data?.properties) {
      console.log(`[nws-zones] store ${store.number}: points fetch failed`);
      failed++;
      continue;
    }
    const forecast_zone = parseZoneCode(data.properties.forecastZone);
    const county_zone = parseZoneCode(data.properties.county);
    if (!forecast_zone && !county_zone) {
      console.log(`[nws-zones] store ${store.number}: no zone codes in response`);
      failed++;
      continue;
    }
    const { error } = await supa.from("store_nws_zones").upsert(
      { store_id: store.id, forecast_zone, county_zone, refreshed_at: new Date().toISOString() },
      { onConflict: "store_id" }
    );
    if (error) {
      console.log(`[nws-zones] store ${store.number}: upsert error ${error.message}`);
      failed++;
      continue;
    }
    refreshed++;
    // NWS asks callers not to hammer /points — 300 ms between requests.
    if (i < candidates.length - 1) await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[nws-zones] refreshed=${refreshed} failed=${failed} skipped=${skipped}`);
  return respond(200, {
    refreshed,
    failed,
    skipped,
    candidates: candidates.length,
    total_with_coords: allStores.length,
  });
};
