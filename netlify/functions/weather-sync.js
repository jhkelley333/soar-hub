// weather-sync — scheduled (3×/day). Thin shell over the shared sync core
// (see _lib/weather-core.js), which an admin can also trigger on demand via
// weather.js ?action=sync. No-ops cleanly if the Weather API key isn't set.

import { createClient } from "@supabase/supabase-js";
import { syncWeather, weatherKeyConfigured } from "./_lib/weather-core.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) { console.warn("[weather-sync] supabase env missing"); return { statusCode: 200, body: "skipped" }; }
  if (!weatherKeyConfigured()) { console.warn("[weather-sync] GOOGLE_WEATHER_API_KEY not set — skipping"); return { statusCode: 200, body: "no key" }; }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await syncWeather(supa);
  console.log(`[weather-sync] locations=${result.locations} recorded=${result.recorded} failed=${result.failed}`);
  return { statusCode: 200, body: JSON.stringify(result) };
};

// 3×/day, ~6am / 12pm / 6pm Central.
export const config = {
  schedule: "0 11,17,23 * * *",
};
