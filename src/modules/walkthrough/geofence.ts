// Walkthrough — geofence math for the GPS check-in gate.
//
// Pure: (device fix + store location) → distance + result band. The check-in
// component owns the geolocation request and the UI; this file just answers
// "how far, and which side of the fence."

import type { GeofenceResult } from "./types";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in meters (haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000; // earth radius, m
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const DEFAULT_GEOFENCE_RADIUS_M = 150;
/** "Nearby" extends one radius past the fence — just-outside, exception-eligible. */
export const NEARBY_FACTOR = 2;

export interface GeofenceEval {
  distanceM: number;
  result: GeofenceResult;
}

/** Classify a device fix against the store's location + radius.
 *  on_site  ≤ radius
 *  nearby   ≤ radius × NEARBY_FACTOR (exception-eligible)
 *  off_site beyond that (blocked) */
export function evaluateGeofence(
  device: LatLng,
  store: LatLng,
  radiusM: number = DEFAULT_GEOFENCE_RADIUS_M,
): GeofenceEval {
  const distanceM = haversineMeters(device, store);
  let result: GeofenceResult;
  if (distanceM <= radiusM) result = "on_site";
  else if (distanceM <= radiusM * NEARBY_FACTOR) result = "nearby";
  else result = "off_site";
  return { distanceM, result };
}

/** Human distance for the UI ("80 m" / "1.2 km"). */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
