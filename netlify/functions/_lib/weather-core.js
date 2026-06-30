// Weather sync core — shared by the scheduled weather-sync function and the
// admin "sync now" trigger in weather.js. Groups active stores by city, pulls
// Google Weather once per city, and records each pull in weather_observations.

const WEATHER_KEY = process.env.GOOGLE_WEATHER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GEOCODE_KEY = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
// Google Maps Weather "forecast/days:lookup" supports up to 10 days. We
// surface them all; the dashboard widget keeps showing just the next few
// while the Weather page renders the full 10-day strip.
const FORECAST_DAYS = 10;

export function weatherKeyConfigured() {
  return !!WEATHER_KEY;
}

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
    const dd = d.displayDate || {};
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
    // forecast/days:lookup paginates independently of `days` — pageSize
    // defaults to 5, so without it Google silently returns only the first
    // 5 days no matter how high `days` is set. Match pageSize to
    // FORECAST_DAYS (both cap at 10) to get the full set in one call.
    fetch(`${base}/forecast/days:lookup?key=${WEATHER_KEY}&unitsSystem=IMPERIAL&days=${FORECAST_DAYS}&pageSize=${FORECAST_DAYS}&${ll}`),
  ]);
  const current = curRes.ok ? await curRes.json() : null;
  const forecast = fcRes.ok ? await fcRes.json() : null;
  if (!current && !forecast) {
    const detail = !curRes.ok ? await curRes.text().catch(() => "") : "";
    throw new Error(`Weather API ${curRes.status}: ${String(detail).slice(0, 160)}`);
  }
  return { current, forecast };
}

// Run a full sync against the given service-role supabase client.
export async function syncWeather(supa) {
  if (!WEATHER_KEY) return { ok: false, reason: "no_key", locations: 0, recorded: 0, failed: 0 };

  const { data: stores } = await supa
    .from("stores").select("city, state, latitude, longitude").eq("is_active", true);

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

  if (locations.length) {
    const { error: upErr } = await supa.from("weather_locations").upsert(
      locations.map((l) => ({ ...l, is_active: true })),
      { onConflict: "city,state" },
    );
    if (upErr) return { ok: false, reason: "db", error: `weather_locations write failed: ${upErr.message}`, locations: 0, recorded: 0, failed: 0 };
  }
  const { data: locRows, error: selErr } = await supa.from("weather_locations").select("id, city, state, latitude, longitude");
  if (selErr) return { ok: false, reason: "db", error: `weather_locations read failed: ${selErr.message}`, locations: 0, recorded: 0, failed: 0 };
  const locById = new Map((locRows || []).map((r) => [`${r.city}|${r.state}`, r]));

  const businessDate = new Date().toISOString().slice(0, 10);
  let recorded = 0, failed = 0, firstError = null;
  await mapLimit(locations, 12, async (l) => {
    const row = locById.get(`${l.city}|${l.state}`);
    if (!row) { failed++; return; }
    try {
      const { current, forecast } = await pullWeather(row.latitude, row.longitude);
      const { error: insErr } = await supa.from("weather_observations").insert({
        location_id: row.id,
        business_date: businessDate,
        ...parseCurrent(current),
        forecast: parseForecast(forecast),
        raw: { current, forecast },
      });
      if (insErr) { failed++; if (!firstError) firstError = insErr.message; return; }
      await supa.from("weather_locations").update({ last_synced_at: new Date().toISOString() }).eq("id", row.id);
      recorded++;
    } catch (e) {
      console.warn(`[weather] ${l.label}: ${e.message}`);
      failed++;
      if (!firstError) firstError = e.message;
    }
  });

  return { ok: true, locations: locations.length, recorded, failed, error: recorded === 0 ? firstError : null };
}

// Backfill historical daily weather from Open-Meteo's free archive (no key) into
// weather_observations — one row per (city, past date). Processes a slice of
// weather_locations per call (offset/limit) so the client can loop without
// hitting the function timeout. Idempotent: skips dates already recorded.
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const arr = (a) => (Array.isArray(a) ? a : []);

// Open-Meteo's free archive rate-limits bursts (429) and occasionally 5xxs.
// Retry with backoff so a large multi-city backfill doesn't shed cities to a
// transient per-minute limit. Non-retryable errors (e.g. 400 bad coords)
// return immediately.
async function fetchArchiveWithRetry(url, tries = 4) {
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return { ok: true, res };
    lastStatus = res.status;
    lastBody = (await res.text().catch(() => "")).slice(0, 140);
    if (res.status !== 429 && res.status < 500) break; // only retry rate-limit / server errors
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
  }
  return { ok: false, status: lastStatus, body: lastBody };
}

export async function backfillHistory(supa, { startDate, endDate, offset = 0, limit = 12 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || "")) {
    return { ok: false, error: "start_date and end_date (YYYY-MM-DD) are required." };
  }
  const { count: total } = await supa.from("weather_locations").select("id", { count: "exact", head: true });
  const { data: locs, error } = await supa
    .from("weather_locations").select("id, latitude, longitude")
    .order("id").range(offset, offset + limit - 1);
  if (error) return { ok: false, error: error.message };

  let inserted = 0, failed = 0, firstError = null;
  await mapLimit(locs || [], 4, async (l) => {
    try {
      // A city with no geocode can't be looked up — surface it plainly rather
      // than firing a guaranteed-400 request that no retry can fix.
      if (l.latitude == null || l.longitude == null) {
        failed++;
        if (!firstError) firstError = "One or more cities have no coordinates (lat/long) on file.";
        return;
      }
      const url = `${ARCHIVE_URL}?latitude=${l.latitude}&longitude=${l.longitude}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&timezone=auto`;
      const fetched = await fetchArchiveWithRetry(url);
      if (!fetched.ok) {
        failed++;
        if (!firstError) {
          firstError = fetched.status === 429
            ? "Open-Meteo rate limit (429) — re-run to fill the gaps; existing days are skipped."
            : `Archive API ${fetched.status}: ${fetched.body}`;
        }
        return;
      }
      const res = fetched.res;
      const j = await res.json();
      const time = arr(j?.daily?.time), hi = arr(j?.daily?.temperature_2m_max), lo = arr(j?.daily?.temperature_2m_min), pr = arr(j?.daily?.precipitation_sum);
      if (!time.length) return;

      const { data: existing } = await supa
        .from("weather_observations").select("business_date")
        .eq("location_id", l.id).gte("business_date", startDate).lte("business_date", endDate);
      const have = new Set((existing || []).map((r) => r.business_date));

      const rows = [];
      for (let i = 0; i < time.length; i++) {
        const date = time[i];
        if (have.has(date)) continue;
        const hiF = num(hi[i]), loF = num(lo[i]);
        rows.push({
          location_id: l.id,
          business_date: date,
          observed_at: `${date}T12:00:00Z`,
          temp_f: hiF,
          forecast: [{ date, hi_f: hiF, lo_f: loF, precip_in: num(pr[i]) }],
          raw: { source: "open-meteo-archive" },
        });
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { error: insErr } = await supa.from("weather_observations").insert(rows.slice(i, i + 500));
        if (insErr) { failed++; if (!firstError) firstError = insErr.message; break; }
        inserted += Math.min(500, rows.length - i);
      }
    } catch (e) {
      failed++; if (!firstError) firstError = e.message;
    }
  });

  const processed = offset + (locs?.length || 0);
  // Surface the first failure reason whenever anything failed — not only when
  // every row failed — so the caller can tell rate-limits from bad data.
  return { ok: true, total: total || 0, processed, inserted, failed, done: processed >= (total || 0), error: failed ? firstError : null };
}
