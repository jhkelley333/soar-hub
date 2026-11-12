// nws-alerts-poll-background — 1-minute Netlify background function.
// Polls NWS for active alerts in every state covered by active stores,
// upserts weather_alerts, and rebuilds weather_alert_stores by zone/polygon match.

import { createClient } from "@supabase/supabase-js";
import { nwsFetch, NWS_BASE, parseZoneCode, pointInPolygon } from "./_lib/nwsAlerts.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log("[nws-poll] env vars missing — skipping");
    return { statusCode: 200, body: "skipped" };
  }
  const supa = admin();

  await expireStaleAlerts(supa);
  await seedMissingZones(supa, 10); // top up any stores missing zone data

  const states = await getActiveStates(supa);
  if (!states.length) {
    console.log("[nws-poll] no active states");
    return { statusCode: 200, body: "no states" };
  }

  const features = await fetchAlertsByStates(states);
  console.log(`[nws-poll] ${states.length} states → ${features.length} raw alert features`);

  if (features.length) {
    await upsertAlerts(supa, features);
    await markSuperseded(supa, features);
  }

  // Always rebuild matches so expirations are reflected even on empty polls.
  const matched = await recomputeStoreMatches(supa);
  console.log(`[nws-poll] ${matched} active store-alert pairs`);

  return {
    statusCode: 200,
    body: `states=${states.length} alerts=${features.length} matches=${matched}`,
  };
};

export const config = {
  schedule: "* * * * *",
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function expireStaleAlerts(supa) {
  const now = new Date().toISOString();
  const { error } = await supa
    .from("weather_alerts")
    .update({ status: "expired", last_seen_at: now })
    .eq("status", "active")
    .or(`expires.lt.${now},ends.lt.${now}`);
  if (error) console.log(`[nws-poll] expire error: ${error.message}`);
}

async function seedMissingZones(supa, limit) {
  const { data: stores } = await supa
    .from("stores")
    .select("id, latitude, longitude")
    .eq("is_active", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null);
  if (!stores?.length) return;
  const { data: existing } = await supa.from("store_nws_zones").select("store_id");
  const have = new Set((existing || []).map((r) => r.store_id));
  const missing = stores.filter((s) => !have.has(s.id)).slice(0, limit);
  for (let i = 0; i < missing.length; i++) {
    const s = missing[i];
    const { ok, data } = await nwsFetch(
      `${NWS_BASE}/points/${s.latitude.toFixed(4)},${s.longitude.toFixed(4)}`
    );
    if (!ok || !data?.properties) continue;
    const forecast_zone = parseZoneCode(data.properties.forecastZone);
    const county_zone = parseZoneCode(data.properties.county);
    if (forecast_zone || county_zone) {
      await supa.from("store_nws_zones").upsert(
        { store_id: s.id, forecast_zone, county_zone, refreshed_at: new Date().toISOString() },
        { onConflict: "store_id" }
      );
    }
    if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
}

async function getActiveStates(supa) {
  const { data } = await supa
    .from("stores")
    .select("state")
    .eq("is_active", true)
    .not("state", "is", null);
  const states = [
    ...new Set(
      (data || [])
        .map((r) => String(r.state || "").trim().toUpperCase())
        .filter((s) => s.length === 2)
    ),
  ];
  return states;
}

async function fetchAlertsByStates(states) {
  const results = await Promise.all(
    states.map(async (state) => {
      const { ok, data } = await nwsFetch(
        `${NWS_BASE}/alerts/active?area=${state}&status=actual`
      );
      if (!ok || !data?.features) return [];
      return data.features;
    })
  );
  // Deduplicate — an alert spanning a state line appears in both responses.
  const seen = new Set();
  const out = [];
  for (const batch of results) {
    for (const f of batch) {
      const id = f.id || f.properties?.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(f);
      }
    }
  }
  return out;
}

async function upsertAlerts(supa, features) {
  const now = new Date().toISOString();
  const rows = features.map((f) => {
    const p = f.properties || {};
    const id = f.id || p.id;
    const refIds = (p.references || [])
      .map((r) => r["@id"] || r.identifier)
      .filter(Boolean);
    return {
      alert_id: id,
      event: p.event || "Unknown",
      severity: p.severity || null,
      urgency: p.urgency || null,
      certainty: p.certainty || null,
      headline: p.headline || null,
      description: p.description || null,
      instruction: p.instruction || null,
      sent: p.sent || null,
      effective: p.effective || null,
      onset: p.onset || null,
      expires: p.expires || null,
      ends: p.ends || null,
      message_type: p.messageType || "Alert",
      referenced_alerts: refIds,
      ugc: p.geocode?.UGC || [],
      geometry: f.geometry || null,
      raw: { id, properties: p },
      status: "active",
      last_seen_at: now,
    };
  });

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supa
      .from("weather_alerts")
      .upsert(rows.slice(i, i + 100), { onConflict: "alert_id", ignoreDuplicates: false });
    if (error) console.log(`[nws-poll] upsert batch error: ${error.message}`);
  }
}

async function markSuperseded(supa, features) {
  const toCancel = new Set();
  for (const f of features) {
    const p = f.properties || {};
    if (p.messageType !== "Cancel" && p.messageType !== "Update") continue;
    for (const ref of p.references || []) {
      const id = ref["@id"] || ref.identifier;
      if (id) toCancel.add(id);
    }
  }
  if (!toCancel.size) return;
  await supa
    .from("weather_alerts")
    .update({ status: "cancelled", last_seen_at: new Date().toISOString() })
    .in("alert_id", [...toCancel])
    .eq("status", "active");
}

async function recomputeStoreMatches(supa) {
  const { data: alerts } = await supa
    .from("weather_alerts")
    .select("alert_id, ugc, geometry")
    .eq("status", "active");

  // Clear matches for no-longer-active alerts.
  const { data: inactive } = await supa
    .from("weather_alerts")
    .select("alert_id")
    .neq("status", "active");
  if (inactive?.length) {
    await supa
      .from("weather_alert_stores")
      .delete()
      .in("alert_id", inactive.map((a) => a.alert_id));
  }

  if (!alerts?.length) return 0;

  // Load zones + coordinates for all active stores.
  const { data: zones } = await supa
    .from("store_nws_zones")
    .select("store_id, forecast_zone, county_zone");
  const { data: stores } = await supa
    .from("stores")
    .select("id, latitude, longitude")
    .eq("is_active", true);

  const zoneByStore = new Map((zones || []).map((z) => [z.store_id, z]));
  const coordByStore = new Map(
    (stores || []).map((s) => [s.id, { lat: s.latitude, lng: s.longitude }])
  );

  const newPairs = [];
  for (const alert of alerts) {
    const ugcSet = new Set(alert.ugc || []);
    const hasPolygon = !!alert.geometry;

    for (const [storeId, zone] of zoneByStore) {
      const coords = coordByStore.get(storeId);

      // Polygon match takes priority over zone match.
      if (hasPolygon && coords?.lat != null && coords?.lng != null) {
        if (pointInPolygon(coords.lat, coords.lng, alert.geometry)) {
          newPairs.push({ alert_id: alert.alert_id, store_id: storeId, match_type: "polygon" });
          continue;
        }
      }

      // Zone (UGC) match.
      if (
        (zone.forecast_zone && ugcSet.has(zone.forecast_zone)) ||
        (zone.county_zone && ugcSet.has(zone.county_zone))
      ) {
        newPairs.push({ alert_id: alert.alert_id, store_id: storeId, match_type: "zone" });
      }
    }
  }

  // Replace existing matches for active alerts.
  const activeIds = alerts.map((a) => a.alert_id);
  await supa.from("weather_alert_stores").delete().in("alert_id", activeIds);

  for (let i = 0; i < newPairs.length; i += 500) {
    const { error } = await supa
      .from("weather_alert_stores")
      .insert(newPairs.slice(i, i + 500));
    if (error) console.log(`[nws-poll] match insert error: ${error.message}`);
  }

  return newPairs.length;
}
