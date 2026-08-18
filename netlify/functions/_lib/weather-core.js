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

// ── Open-Meteo fallback (no API key) ─────────────────────────────────────────
// Keeps daily recording alive whenever the Google Weather key is unset or a
// Google pull fails — the same free provider the historical backfill uses. Maps
// WMO weather codes to plain text (Open-Meteo has no condition string or icon).
const WMO = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
  77: "Snow grains", 80: "Rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Thunderstorm w/ hail",
};

async function pullOpenMeteoForecast(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=${FORECAST_DAYS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${String(await res.text().catch(() => "")).slice(0, 160)}`);
  const j = await res.json();
  const c = j?.current || {};
  const code = num(c.weather_code);
  const currentParsed = {
    temp_f: num(c.temperature_2m),
    feels_like_f: num(c.apparent_temperature),
    condition: code != null ? (WMO[code] ?? null) : null,
    condition_type: code != null ? `WMO_${code}` : null,
    icon_uri: null,
    humidity_pct: num(c.relative_humidity_2m),
    wind_mph: num(c.wind_speed_10m),
    precip_prob_pct: null,
  };
  const d = j?.daily || {};
  const t = arr(d.time), hi = arr(d.temperature_2m_max), lo = arr(d.temperature_2m_min);
  const pr = arr(d.precipitation_sum), pp = arr(d.precipitation_probability_max), wc = arr(d.weather_code);
  const forecastParsed = t.map((date, i) => {
    const dcode = num(wc[i]);
    return {
      date,
      hi_f: num(hi[i]),
      lo_f: num(lo[i]),
      condition: dcode != null ? (WMO[dcode] ?? null) : null,
      icon: null,
      precip_prob: num(pp[i]),
      precip_in: num(pr[i]),
    };
  });
  return { currentParsed, forecastParsed, raw: { source: "open-meteo-forecast", current: j?.current ?? null } };
}

// One observation for a location: Google when its key is set (icons + rich
// conditions), otherwise Open-Meteo. If Google errors, fall back to Open-Meteo
// so a daily row is still recorded rather than lost.
async function getObservation(lat, lng) {
  if (WEATHER_KEY) {
    try {
      const { current, forecast } = await pullWeather(lat, lng);
      return { currentParsed: parseCurrent(current), forecastParsed: parseForecast(forecast), raw: { current, forecast }, source: "google" };
    } catch (e) {
      const om = await pullOpenMeteoForecast(lat, lng);
      return { ...om, source: "open-meteo", raw: { ...om.raw, google_error: e.message } };
    }
  }
  const om = await pullOpenMeteoForecast(lat, lng);
  return { ...om, source: "open-meteo" };
}

// Run a full sync against the given service-role supabase client. Records daily
// even without a Google key (Open-Meteo fallback), so weather never silently
// stops accumulating history.
export async function syncWeather(supa) {

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

  const utcToday = new Date().toISOString().slice(0, 10);
  let recorded = 0, failed = 0, firstError = null;
  const sources = { google: 0, "open-meteo": 0 };
  await mapLimit(locations, 12, async (l) => {
    const row = locById.get(`${l.city}|${l.state}`);
    if (!row) { failed++; return; }
    try {
      const { currentParsed, forecastParsed, raw, source } = await getObservation(row.latitude, row.longitude);
      // Stamp the day from the forecast's own day-0 (the location-local "today")
      // so the per-day "actual" hi/lo — derived by matching forecast.date to
      // business_date — always resolves, instead of drifting on the UTC clock.
      const businessDate = forecastParsed.find((f) => f.date)?.date || utcToday;
      const { error: insErr } = await supa.from("weather_observations").insert({
        location_id: row.id,
        business_date: businessDate,
        ...currentParsed,
        forecast: forecastParsed,
        raw,
      });
      if (insErr) { failed++; if (!firstError) firstError = insErr.message; return; }
      await supa.from("weather_locations").update({ last_synced_at: new Date().toISOString() }).eq("id", row.id);
      recorded++;
      sources[source] = (sources[source] || 0) + 1;
    } catch (e) {
      console.warn(`[weather] ${l.label}: ${e.message}`);
      failed++;
      if (!firstError) firstError = e.message;
    }
  });

  // Self-heal: fill any gap between each location's last recorded day and
  // yesterday from the archive, so a stalled schedule (or a paused key) recovers
  // its missing history the next time this runs — automatically, or the instant
  // an admin clicks "Sync now". Best-effort: never fails the live sync.
  let caughtUp = 0;
  try { caughtUp = await catchUpGaps(supa, locRows || [], utcToday); }
  catch (e) { console.warn(`[weather] catch-up failed: ${e.message}`); }

  return { ok: true, locations: locations.length, recorded, failed, caught_up: caughtUp, sources, error: recorded === 0 ? firstError : null };
}

// Local-date arithmetic on a YYYY-MM-DD string (UTC-anchored, DST-safe for
// whole-day steps).
function isoAddDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// For each location, backfill the daily highs/lows for any date missing between
// its last recorded day (exclusive) and yesterday, from the Open-Meteo archive.
// Bounded lookback so a brand-new location doesn't pull years at once. Skips
// days the archive can't provide yet (its ~5-day lag returns nulls) so a later
// run fills them once available. Idempotent — existing days are left untouched.
const CATCHUP_MAX_LOOKBACK_DAYS = 120;
async function catchUpGaps(supa, locRows, todayIso) {
  const yesterday = isoAddDays(todayIso, -1);
  const floor = isoAddDays(todayIso, -CATCHUP_MAX_LOOKBACK_DAYS);
  let filled = 0;
  await mapLimit(locRows, 4, async (l) => {
    if (l.latitude == null || l.longitude == null) return;
    const { data: last } = await supa
      .from("weather_observations").select("business_date")
      .eq("location_id", l.id).lt("business_date", todayIso)
      .order("business_date", { ascending: false }).limit(1);
    const lastDay = last?.[0]?.business_date || null;
    let start = lastDay ? isoAddDays(lastDay, 1) : floor;
    if (start < floor) start = floor;
    if (start > yesterday) return; // no gap to fill

    const url = `${ARCHIVE_URL}?latitude=${l.latitude}&longitude=${l.longitude}&start_date=${start}&end_date=${yesterday}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&timezone=auto`;
    const fetched = await fetchArchiveWithRetry(url);
    if (!fetched.ok) return;
    const j = await fetched.res.json();
    const time = arr(j?.daily?.time), hi = arr(j?.daily?.temperature_2m_max), lo = arr(j?.daily?.temperature_2m_min), pr = arr(j?.daily?.precipitation_sum);
    if (!time.length) return;

    const { data: existing } = await supa
      .from("weather_observations").select("business_date")
      .eq("location_id", l.id).gte("business_date", start).lte("business_date", yesterday);
    const have = new Set((existing || []).map((r) => r.business_date));

    const rows = [];
    for (let i = 0; i < time.length; i++) {
      const date = time[i];
      const hiF = num(hi[i]), loF = num(lo[i]);
      if (have.has(date) || (hiF == null && loF == null)) continue;
      rows.push({
        location_id: l.id, business_date: date, observed_at: `${date}T12:00:00Z`,
        temp_f: hiF, forecast: [{ date, hi_f: hiF, lo_f: loF, precip_in: num(pr[i]) }],
        raw: { source: "open-meteo-archive-catchup" },
      });
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supa.from("weather_observations").insert(rows.slice(i, i + 500));
      if (!error) filled += Math.min(500, rows.length - i);
    }
  });
  return filled;
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
