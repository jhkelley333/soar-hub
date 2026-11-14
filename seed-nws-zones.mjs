// seed-nws-zones.mjs
// Fetches NWS zone codes for every active store that has coordinates
// and upserts them into store_nws_zones.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=xxx node seed-nws-zones.mjs
//
// Optional:
//   NWS_CONTACT_EMAIL=you@example.com  (defaults to env or fallback)
//   BATCH=50                            (stores per run, default all)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mebzvovvdugkwjypwepg.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONTACT = process.env.NWS_CONTACT_EMAIL || "admin@mysoarhub.com";
const UA = `SOARHub-ZoneSeed (${CONTACT})`;
const BATCH = parseInt(process.env.BATCH || "0", 10) || Infinity;

if (!SERVICE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function nwsPoints(lat, lng, retries = 3) {
  const url = `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`;
  for (let i = 0; i < retries; i++) {
    if (i > 0) await sleep(1000 * 2 ** i);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/geo+json" },
      });
      if (res.status === 429 || res.status >= 500) continue;
      if (!res.ok) return null;
      const data = await res.json();
      return data?.properties ?? null;
    } catch {
      // retry
    }
  }
  return null;
}

function parseZone(url) {
  if (!url) return null;
  const parts = String(url).split("/");
  return parts[parts.length - 1] || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Load all active stores with coordinates
  const { data: allStores, error: storeErr } = await supa
    .from("stores")
    .select("id, number, latitude, longitude")
    .eq("is_active", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("number");

  if (storeErr) { console.error("stores query failed:", storeErr.message); process.exit(1); }
  console.log(`Found ${allStores.length} active stores with coordinates.`);

  // Find which ones are missing zone data
  const { data: existing } = await supa.from("store_nws_zones").select("store_id");
  const have = new Set((existing || []).map((r) => r.store_id));
  const missing = allStores.filter((s) => !have.has(s.id));
  console.log(`${have.size} already seeded, ${missing.length} need zones.`);

  const toProcess = missing.slice(0, BATCH);
  if (!toProcess.length) { console.log("Nothing to do."); return; }
  console.log(`Processing ${toProcess.length} stores…\n`);

  let ok = 0, failed = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const s = toProcess[i];
    process.stdout.write(`[${i + 1}/${toProcess.length}] #${s.number} … `);

    const props = await nwsPoints(s.latitude, s.longitude);
    if (!props) {
      console.log("NWS FAILED");
      failed++;
      await sleep(400);
      continue;
    }

    const forecast_zone = parseZone(props.forecastZone);
    const county_zone = parseZone(props.county);

    if (!forecast_zone && !county_zone) {
      console.log("no zones in response");
      failed++;
      await sleep(400);
      continue;
    }

    const { error: upsertErr } = await supa.from("store_nws_zones").upsert(
      { store_id: s.id, forecast_zone, county_zone, refreshed_at: new Date().toISOString() },
      { onConflict: "store_id" }
    );
    if (upsertErr) {
      console.log(`DB error: ${upsertErr.message}`);
      failed++;
    } else {
      console.log(`${forecast_zone ?? "—"} / ${county_zone ?? "—"}`);
      ok++;
    }

    // NWS fair-use: ~300 ms between /points requests
    if (i < toProcess.length - 1) await sleep(320);
  }

  console.log(`\nDone. seeded=${ok} failed=${failed} already_had=${have.size}`);
  if (missing.length > toProcess.length) {
    console.log(`${missing.length - toProcess.length} stores still need zones — re-run to continue.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
