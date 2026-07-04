// Territory Map — typed wrapper around netlify/functions/org?action=territory-map.
// One flat store list; DO assignment and org path are resolved server-side
// from the org data (user_scopes), so the map recolors itself when a
// district's DO changes. Same auth/request pattern as my-stores/api.ts.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/org";

export interface TerritoryStore {
  id: string;
  number: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  district_id: string | null;
  district_name: string | null;
  area_id: string | null;
  area_name: string | null;
  region_id: string | null;
  region_name: string | null;
  do_id: string | null;
  do_name: string | null;
}

export interface TerritoryMapResponse {
  stores: TerritoryStore[];
  total: number;
  missing_coords: number;
  // Full org hierarchy for the filter dropdowns — includes nodes with no
  // mapped stores, so everything is always selectable.
  regions: { id: string; name: string }[];
  areas: { id: string; name: string; region_id: string | null }[];
  districts: { id: string; name: string; area_id: string | null }[];
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

export async function fetchTerritoryMap(): Promise<TerritoryMapResponse> {
  const res = await fetch(`${FN}?action=territory-map`, { headers: await authHeaders() });
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
  return res.json() as Promise<TerritoryMapResponse>;
}
