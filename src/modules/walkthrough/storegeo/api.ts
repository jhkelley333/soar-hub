// Store geofence backfill — set the coordinates the walkthrough GPS check-in
// uses (stores.latitude/longitude/geofence_radius_m, migration 0121). Goes
// through org.js (service role) so the same manage rules as store attributes
// apply: org-wide roles, or DO/SDO/RVP for stores in scope.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/org";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface StoreGeo {
  id: string;
  number: string;
  name: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number | null;
}

export async function listStoresGeo(): Promise<StoreGeo[]> {
  const { stores } = await request<{ stores: StoreGeo[] }>(`${FN}?action=stores-geo`);
  return stores ?? [];
}

export interface GeoUpdate {
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
}

export async function updateStoreGeo(storeId: string, geo: GeoUpdate): Promise<StoreGeo> {
  const { store } = await request<{ store: StoreGeo }>(`${FN}?action=update-store-geo`, {
    method: "POST",
    body: JSON.stringify({ store_id: storeId, ...geo }),
  });
  return store;
}

/** Derive a single store's coordinates from its address (Google geocoding). */
export async function geocodeStore(storeId: string): Promise<StoreGeo> {
  const { store } = await request<{ store: StoreGeo }>(`${FN}?action=geocode-store`, {
    method: "POST",
    body: JSON.stringify({ store_id: storeId }),
  });
  return store;
}

export interface GeocodeMissingResult {
  updated: number;
  failed: number;
  skipped: number;
  remaining: number;
  results: { number: string; status: string; reason?: string }[];
}

/** Geocode a batch of the caller's stores that have no coordinates yet. */
export async function geocodeMissing(): Promise<GeocodeMissingResult> {
  return request<GeocodeMissingResult>(`${FN}?action=geocode-missing`, { method: "POST" });
}
