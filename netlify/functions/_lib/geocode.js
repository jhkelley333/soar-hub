// netlify/functions/_lib/geocode.js
//
// Shared Google Geocoding API wrapper. Originally inline in org.js (the
// walkthrough GPS check-in geofence, migration 0121); extracted so
// org-mgmt.js can call it too for geocode-on-write when a store's address
// is created or edited, without duplicating the fetch/parse logic.

const GEOCODE_KEY = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

export function geocodeConfigured() {
  return !!GEOCODE_KEY;
}

export function storeAddressString(s) {
  return [s.address, s.city, s.state]
    .map((x) => (x || "").trim())
    .filter(Boolean)
    .join(", ");
}

export async function geocodeAddress(address) {
  if (!GEOCODE_KEY) return { error: "geocoding not configured (GOOGLE_GEOCODING_API_KEY)" };
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(address) +
    "&key=" +
    GEOCODE_KEY;
  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `geocoder http ${res.status}` };
    json = await res.json();
  } catch (e) {
    return { error: e?.message || "geocoder request failed" };
  }
  if (json.status === "ZERO_RESULTS") return { error: "no match for address" };
  if (json.status === "OVER_QUERY_LIMIT") return { error: "over query limit" };
  if (json.status !== "OK") return { error: `geocoder: ${json.status}` };
  const loc = json.results?.[0]?.geometry?.location;
  if (!loc || typeof loc.lat !== "number") return { error: "no location in result" };
  return { lat: loc.lat, lng: loc.lng };
}

// Best-effort re-geocode for a store whose address/city/state may have just
// changed. Never throws — a geocoding hiccup must not fail the save that
// triggered it. Returns { latitude, longitude } to merge into the write, or
// null if nothing could be resolved (caller leaves existing coords alone).
export async function geocodeStoreOnWrite(store) {
  try {
    const addr = storeAddressString(store);
    if (!addr) return null;
    const geo = await geocodeAddress(addr);
    if (geo.error) {
      console.warn("[geocode] on-write geocode failed", store.number || store.id, geo.error);
      return null;
    }
    return { latitude: geo.lat, longitude: geo.lng };
  } catch (e) {
    console.warn("[geocode] on-write geocode threw", store.number || store.id, e?.message || e);
    return null;
  }
}
