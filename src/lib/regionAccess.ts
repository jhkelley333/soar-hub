// Per-region module-visibility overrides (Region Access admin page).
//
// Mirrors roleAccess.ts but the axis is region. Every region sees every
// module by default; an override (in practice, visible=false) hides a module
// from users whose scope resolves to that region. Effective visibility =
// role allows (roleAccess) AND region allows (this).
//
// Governs UI/nav/route visibility only — the backend + RLS remain the real
// data boundary.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/region-access";

export interface RegionAccessOverride {
  module_key: string;
  region_id: string;
  visible: boolean;
}

export interface RegionLite {
  id: string;
  name: string;
  code: string | null;
}

// Nested lookup: overrides[moduleKey][regionId] = visible.
export type RegionOverrideMap = Record<string, Record<string, boolean>>;

interface RegionAccessData {
  overrides: RegionOverrideMap;
  regions: RegionLite[];
  myRegionIds: string[];
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function fetchRegionAccess(): Promise<RegionAccessData> {
  const res = await fetch(`${FN}?action=list`, { headers: await authHeaders() });
  if (!res.ok) return { overrides: {}, regions: [], myRegionIds: [] };
  const body = (await res.json()) as {
    ok?: boolean;
    overrides?: RegionAccessOverride[];
    regions?: RegionLite[];
    myRegionIds?: string[];
  };
  const map: RegionOverrideMap = {};
  for (const o of body.overrides ?? []) {
    (map[o.module_key] ||= {})[o.region_id] = o.visible;
  }
  return { overrides: map, regions: body.regions ?? [], myRegionIds: body.myRegionIds ?? [] };
}

// Shared cache key so the nav + every route guard read one response.
export function useRegionAccess(): RegionAccessData & { isLoaded: boolean } {
  const { data, isSuccess } = useQuery({
    queryKey: ["region-access"],
    queryFn: fetchRegionAccess,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return {
    overrides: data?.overrides ?? {},
    regions: data?.regions ?? [],
    myRegionIds: data?.myRegionIds ?? [],
    isLoaded: isSuccess,
  };
}

// Region gate. Default visible; a module is hidden only when EVERY region the
// caller belongs to has it explicitly disabled. No regions (global scope /
// unresolved) → no gating.
export function regionVisible(
  moduleKey: string,
  myRegionIds: string[],
  overrides: RegionOverrideMap,
): boolean {
  if (!myRegionIds.length) return true;
  return myRegionIds.some((rid) => overrides[moduleKey]?.[rid] !== false);
}

// Admin writes.
export async function setRegionAccess(module_key: string, region_id: string, visible: boolean): Promise<void> {
  const res = await fetch(`${FN}?action=set`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ module_key, region_id, visible }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || "Couldn't save.");
  }
}

export async function clearRegionAccess(module_key: string, region_id: string): Promise<void> {
  const res = await fetch(`${FN}?action=clear`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ module_key, region_id }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || "Couldn't reset.");
  }
}
