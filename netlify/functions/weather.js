// weather — read API for the dashboard. Serves the latest recorded observation
// for a store's city (no Google call here; weather-sync writes the data). Also
// returns a short history for trend lookback.
//
//   GET ?action=for-store&store_id=…   -> { location, current, forecast, observed_at }
//   GET ?action=history&store_id=…&days=30 -> { location, points: [{date, temp_f, hi_f, lo_f}] }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("weather env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getUser(event, supa) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const { data, error } = await supa.auth.getUser(header.slice(7).trim());
  return error ? null : data?.user || null;
}

// Resolve a store id -> its weather location row (by city/state).
async function locationForStore(supa, storeId) {
  if (!storeId) return null;
  const { data: store } = await supa.from("stores").select("city, state").eq("id", storeId).maybeSingle();
  if (!store?.city || !store?.state) return null;
  const { data: loc } = await supa
    .from("weather_locations")
    .select("id, city, state, label")
    .eq("city", String(store.city).trim())
    .eq("state", String(store.state).trim().toUpperCase())
    .maybeSingle();
  return loc || null;
}

async function forStore(supa, storeId) {
  const loc = await locationForStore(supa, storeId);
  if (!loc) return { location: null, current: null, forecast: [], observed_at: null };
  const { data: obs } = await supa
    .from("weather_observations")
    .select("observed_at, temp_f, feels_like_f, condition, condition_type, icon_uri, humidity_pct, wind_mph, precip_prob_pct, forecast")
    .eq("location_id", loc.id)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!obs) return { location: loc, current: null, forecast: [], observed_at: null };
  const { forecast, observed_at, ...current } = obs;
  return { location: loc, current, forecast: forecast || [], observed_at };
}

async function history(supa, storeId, days) {
  const loc = await locationForStore(supa, storeId);
  if (!loc) return { location: null, points: [] };
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 365)) * 86400000).toISOString();
  const { data } = await supa
    .from("weather_observations")
    .select("observed_at, business_date, temp_f, forecast")
    .eq("location_id", loc.id)
    .gte("observed_at", since)
    .order("observed_at", { ascending: true });
  // One point per business_date: the day's recorded temp + that day's hi/lo from the forecast snapshot.
  const byDay = new Map();
  for (const o of data || []) {
    const fcToday = (o.forecast || []).find((f) => f.date === o.business_date);
    byDay.set(o.business_date, { date: o.business_date, temp_f: o.temp_f, hi_f: fcToday?.hi_f ?? null, lo_f: fcToday?.lo_f ?? null });
  }
  return { location: loc, points: [...byDay.values()] };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getUser(event, supa);
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "for-store";
  try {
    if (action === "for-store") return respond(200, await forStore(supa, params.store_id));
    if (action === "history") return respond(200, await history(supa, params.store_id, parseInt(params.days, 10) || 30));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
