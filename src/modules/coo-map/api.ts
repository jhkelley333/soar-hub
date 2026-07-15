// COO map — client wrappers around the coo-map function.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/coo-map";

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

function callWith(path: string, init: RequestInit, token: string): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await callWith(path, init, await authToken());
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    const fresh = data.session?.access_token;
    if (fresh) res = await callWith(path, init, fresh);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface CooCompany { id: string; slug: string; name: string }
export interface ApricusStore {
  number: string; name: string; address: string | null; state: string | null; zip: string | null;
  latitude: number | null; longitude: number | null;
  market: string | null; do_name: string | null; dm_name: string | null; gm_name: string | null;
  phone: string | null; drive_thru: string | null;
}
export interface CooMapResponse { ok: true; companies: CooCompany[]; apricus: ApricusStore[] }

// Cross-brand map data (Apricus side). Sonic comes from the territory map.
// 403s for users without multi-company access.
export function fetchCooMapStores(): Promise<CooMapResponse> {
  return req<CooMapResponse>(`${FN}?action=stores`);
}

export interface GeocodeResult {
  ok: true;
  geocoded: number;
  failed: { number: string; name: string; error: string }[];
  flagged: { number: string; name: string; lat: number; lng: number }[];
  remaining: number;
  done: boolean;
}

// Batch-geocode Apricus stores with no coordinates. Time-budgeted server-side —
// call repeatedly until `done` is true.
export function geocodeApricus(): Promise<GeocodeResult> {
  return req<GeocodeResult>(`${FN}?action=geocode-apricus`, { method: "POST", body: "{}" });
}
