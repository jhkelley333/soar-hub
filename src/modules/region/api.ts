// Region rollup data. Reuses the existing `fetchMyTree()` from the org
// function (RLS-scoped to what the caller can see) and flattens it into
// a single list of stores annotated with their leadership + a placeholder
// score / tier from `./scoring`.
//
// Nothing here writes — the page is read-only and the scoring is fake.

import { fetchMyTree } from "@/modules/my-stores/api";
import type {
  MyTreeResponse,
  StoreLeadership,
} from "@/modules/my-stores/types";
import type { Tier } from "@/shared/ui/Tier";
import {
  placeholderOpenWorkOrders,
  placeholderScore,
  placeholderSparkline,
  placeholderTrend,
  tierFromOpenWorkOrders,
} from "./scoring";

export interface RegionStore {
  id: string;
  sdi: string;          // store number (the "SDI 4287" the field uses)
  city: string | null;
  state: string | null;
  districtId: string | null;
  districtCode: string | null;
  regionId: string | null;
  regionName: string | null;
  gm: string | null;
  do: string | null;
  // Placeholder fields — see ./scoring.
  openWorkOrders: number;
  score: number;
  tier: Tier;
  trend: number;
  sparkline: number[];
}

export interface RegionRollup {
  /** Human-readable label for the current scope: a region name for an
   *  RVP, a district code for a DO, etc. Falls back to "My stores". */
  scopeLabel: string;
  /** "47 stores · 4 districts" — used as the subtitle. */
  scopeSummary: string;
  stores: RegionStore[];
  counts: { all: number; green: number; yellow: number; red: number };
  /** Weighted region average of placeholder scores, 0-100. */
  index: number;
  trend: number;
}

function displayName(p: { full_name: string | null; preferred_name: string | null; email: string } | null): string | null {
  if (!p) return null;
  return p.preferred_name || p.full_name || p.email || null;
}

function flatten(tree: MyTreeResponse): RegionStore[] {
  const out: RegionStore[] = [];
  for (const region of tree.regions) {
    for (const area of region.areas) {
      for (const district of area.districts) {
        for (const s of district.stores) {
          const leadership: StoreLeadership | undefined = tree.leadership[s.id];
          const open = placeholderOpenWorkOrders(s.id);
          const tier = tierFromOpenWorkOrders(open);
          const score = placeholderScore(s.id, open);
          out.push({
            id: s.id,
            sdi: s.number,
            city: s.city,
            state: s.state,
            districtId: district.id,
            districtCode: district.code,
            regionId: region.id,
            regionName: region.name,
            gm: displayName(leadership?.gm ?? null),
            do: displayName(leadership?.do ?? null),
            openWorkOrders: open,
            score,
            tier,
            trend: placeholderTrend(s.id),
            sparkline: placeholderSparkline(s.id, score),
          });
        }
      }
    }
  }
  return out;
}

function buildScope(tree: MyTreeResponse, stores: RegionStore[]): {
  scopeLabel: string;
  scopeSummary: string;
} {
  const regions = tree.regions;
  if (regions.length === 1) {
    const r = regions[0];
    const districts = r.areas.flatMap((a) => a.districts);
    return {
      scopeLabel: r.name || r.code || "My region",
      scopeSummary: `${stores.length} stores · ${districts.length} district${districts.length === 1 ? "" : "s"}`,
    };
  }
  if (regions.length > 1) {
    const districts = regions.flatMap((r) => r.areas.flatMap((a) => a.districts));
    return {
      scopeLabel: `${regions.length} regions`,
      scopeSummary: `${stores.length} stores · ${districts.length} districts`,
    };
  }
  return { scopeLabel: "My stores", scopeSummary: `${stores.length} stores` };
}

export async function fetchRegionRollup(): Promise<RegionRollup> {
  const tree = await fetchMyTree();
  const stores = flatten(tree);
  const counts = {
    all: stores.length,
    green: stores.filter((s) => s.tier === "green").length,
    yellow: stores.filter((s) => s.tier === "yellow").length,
    red: stores.filter((s) => s.tier === "red").length,
  };
  const index =
    stores.length === 0
      ? 0
      : Math.round(
          (stores.reduce((sum, s) => sum + s.score, 0) / stores.length) * 10,
        ) / 10;
  const scope = buildScope(tree, stores);
  return {
    ...scope,
    stores,
    counts,
    index,
    trend: 0, // weekly trend not computed yet
  };
}
