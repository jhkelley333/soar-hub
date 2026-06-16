// weather-sync — scheduled (3×/day). Groups active stores by city, pulls
// Google Weather once per city (centralized — a 7-store town = 1 pull), and
// records each pull in weather_observations for history. Reads are served from
// the DB by weather.js, so the dashboard never calls Google.
//
// No-ops (logs + exits) if GOOGLE_WEATHER_API_KEY / GOOGLE_MAPS_API_KEY isn't
// set, so it can't break a deploy before the key is provisioned.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEATHER_KEY = process.env.GOOGLE_WEATHER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GEOCODE_KEY = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const FORECAST_DAYS = 5;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Bounded-concurrency map so ~150 cities don't take 150 sequential round-trips.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function geocodeCity(label) {
  if (!GEOCODE_KEY) return null;
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(label)}&key=${GEOCODE_KEY}`);
    const j = await res.json();
    const loc = j?.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch { return null; }
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Defensive parse of Google's Weather payloads — store the raw too so we can
// adjust extraction without a re-pull if field names differ.
function parseCurrent(c) {
  if (!c) return {};
  return {
    temp_f: num(c.temperature?.degrees),
    feels_like_f: num(c.feelsLikeTemperature?.degrees),
    condition: c.weatherCondition?.description?.text ?? null,
    condition_type: c.weatherCondition?.type ?? null,
    icon_uri: c.weatherCondition?.iconBaseUri ? `${c.weatherCondition.iconBaseUri}.png` : null,
    humidity_pct: num(c.relativeHumidity),
    wind_mph: num(c.wind?.speed?.value),
    precip_prob_pct: num(c.precipitation?.probability?.percent),
  };
}
function parseForecast(f) {
  const days = f?.forecastDays || [];
  return days.map((d) => {
    const day = d.daytimeForecast || {};
    const dd = d.displayDate || d.interval?.startTime || {};
    const date = dd.year ? `${dd.year}-${String(dd.month).padStart(2, "0")}-${String(dd.day).padStart(2, "0")}` : null;
    return {
      date,
      hi_f: num(d.maxTemperature?.degrees),
      lo_f: num(d.minTemperature?.degrees),
      condition: day.weatherCondition?.description?.text ?? null,
      icon: day.weatherCondition?.iconBaseUri ? `${day.weatherCondition.iconBaseUri}.png` : null,
      precip_prob: num(day.precipitation?.probability?.percent),
    };
  });
}

async function pullWeather(lat, lng) {
  const base = "https://weather.googleapis.com/v1";
  const ll = `location.latitude=${lat}&location.longitude=${lng}`;
  const [curRes, fcRes] = await Promise.all([
    fetch(`${base}/currentConditions:lookup?key=${WEATHER_KEY}&unitsSystem=IMPERIAL&${ll}`),
    fetch(`${base}/forecast/days:lookup?key=${WEATHER_KEY}&unitsSystem=IMPERIAL&days=${FORECAST_DAYS}&${ll}`),
  ]);
  const current = curRes.ok ? await curRes.json() : null;
  const forecast = fcRes.ok ? await fcRes.json() : null;
  if (!current && !forecast) {
    const detail = !curRes.ok ? await curRes.text().catch(() => "") : "";
    throw new Error(`Weather API ${curRes.status}: ${String(detail).slice(0, 160)}`);
  }
  return { current, forecast };
}

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) { console.warn("[weather-sync] supabase env missing"); return { statusCode: 200, body: "skipped" }; }
  if (!WEATHER_KEY) { console.warn("[weather-sync] GOOGLE_WEATHER_API_KEY not set — skipping"); return { statusCode: 200, body: "no key" }; }
  const supa = admin();

  // 1) Active stores with a usable city + state.
  const { data: stores } = await supa
    .from("stores")
    .select("city, state, latitude, longitude")
    .eq("is_active", true);

  // 2) Group by normalized (city, state); centroid of stores that have coords.
  const groups = new Map();
  for (const s of stores || []) {
    const city = String(s.city || "").trim();
    const state = String(s.state || "").trim().toUpperCase();
    if (!city || !state) continue;
    const k = `${city}|${state}`;
    const g = groups.get(k) || { city, state, lats: [], lngs: [], count: 0 };
    g.count++;
    if (Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) { g.lats.push(s.latitude); g.lngs.push(s.longitude); }
    groups.set(k, g);
  }

  // 3) Resolve a lat/lng per group (centroid, else geocode the city once).
  const locations = [];
  for (const g of groups.values()) {
    let lat, lng;
    if (g.lats.length) {
      lat = g.lats.reduce((a, b) => a + b, 0) / g.lats.length;
      lng = g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length;
    } else {
      const geo = await geocodeCity(`${g.city}, ${g.state}`);
      if (!geo) continue;
      lat = geo.lat; lng = geo.lng;
    }
    locations.push({ city: g.city, state: g.state, label: `${g.city}, ${g.state}`, latitude: lat, longitude: lng, store_count: g.count });
  }

  // Upsert the location rows.
  if (locations.length) {
    await supa.from("weather_locations").upsert(
      locations.map((l) => ({ ...l, is_active: true })),
      { onConflict: "city,state" },
    );
  }
  const { data: locRows } = await supa.from("weather_locations").select("id, city, state, latitude, longitude");
  const locById = new Map((locRows || []).map((r) => [`${r.city}|${r.state}`, r]));

  // 4) Pull weather per location (bounded concurrency) + record an observation.
  const businessDate = new Date().toISOString().slice(0, 10);
  let ok = 0, failed = 0;
  await mapLimit(locations, 12, async (l) => {
    const row = locById.get(`${l.city}|${l.state}`);
    if (!row) { failed++; return; }
    try {
      const { current, forecast } = await pullWeather(row.latitude, row.longitude);
      const cur = parseCurrent(current);
      await supa.from("weather_observations").insert({
        location_id: row.id,
        business_date: businessDate,
        ...cur,
        forecast: parseForecast(forecast),
        raw: { current, forecast },
      });
      await supa.from("weather_locations").update({ last_synced_at: new Date().toISOString() }).eq("id", row.id);
      ok++;
    } catch (e) {
      console.warn(`[weather-sync] ${l.label}: ${e.message}`);
      failed++;
    }
  });

  console.log(`[weather-sync] locations=${locations.length} recorded=${ok} failed=${failed}`);
  return { statusCode: 200, body: JSON.stringify({ locations: locations.length, recorded: ok, failed }) };
};

// 3×/day, ~6am / 12pm / 6pm Central.
export const config = {
  schedule: "0 11,17,23 * * *",
};
