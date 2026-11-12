// Shared NWS alert utilities — fetch helpers, zone parsing, PIP geometry.

export const NWS_BASE = "https://api.weather.gov";

function userAgent() {
  const contact = process.env.NWS_CONTACT_EMAIL || "admin@mysoarhub.com";
  return `SOARHub-WeatherAlerts (${contact})`;
}

// Fetch a NWS URL with retry on 429 / 5xx. Returns { ok, data } or { ok: false, error }.
export async function nwsFetch(url, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent(), Accept: "application/geo+json" },
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = `NWS HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) return { ok: false, error: `NWS HTTP ${res.status}` };
      return { ok: true, data: await res.json() };
    } catch (e) {
      lastErr = e?.message || String(e);
    }
  }
  return { ok: false, error: lastErr || "nwsFetch failed" };
}

// "https://api.weather.gov/zones/forecast/TXZ085" → "TXZ085"
export function parseZoneCode(url) {
  if (!url) return null;
  const parts = String(url).split("/");
  return parts[parts.length - 1] || null;
}

// Ray-casting point-in-polygon for a GeoJSON Polygon or MultiPolygon.
// GeoJSON coords are [lng, lat]; stores are stored as (latitude, longitude).
export function pointInPolygon(lat, lng, geometry) {
  if (!geometry || lat == null || lng == null) return false;
  const rings =
    geometry.type === "Polygon"
      ? [geometry.coordinates[0]]
      : geometry.type === "MultiPolygon"
      ? geometry.coordinates.map((p) => p[0])
      : [];
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; // [lng, lat]
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}
