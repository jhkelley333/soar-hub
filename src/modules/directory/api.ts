// Directory data — flattens the org tree from fetchMyTree() into role-
// grouped people lists for the mobile contacts directory.
//
// Real data: pulled from manageable_users() via the existing org
// function, so RLS keeps the list scoped to who the caller can see.

import { fetchMyTree } from "@/modules/my-stores/api";
import type {
  LeadershipPerson,
  MyTreeResponse,
} from "@/modules/my-stores/types";
import type { UserRole } from "@/types/database";

export interface DirectoryPerson {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;           // raw role string (gm / do / sdo / ...)
  /** "GM · SDI 4287" / "DO · D-14B · 9 stores" — short subtitle line */
  subtitle: string;
  /** Used for the optional grouping label under the row. */
  districtCode: string | null;
}

export interface DirectorySection {
  /** "My team" / "My district" — varies by caller role. */
  title: string;
  people: DirectoryPerson[];
}

export interface DirectoryData {
  scopeLabel: string;          // e.g. "Region 14"
  totalCount: number;          // total unique people across all scopes
  pinned: DirectorySection;    // role-aware quick-access section
  district: DirectoryPerson[]; // GMs in caller's district(s)
  region: DirectoryPerson[];   // DOs in caller's region(s)
  aboveStore: DirectoryPerson[]; // SDO + RVP + VP + COO in scope
}

function nameOf(p: LeadershipPerson | null): string {
  if (!p) return "";
  return p.preferred_name || p.full_name || p.email || "";
}

function toPerson(
  p: LeadershipPerson,
  subtitle: string,
  districtCode: string | null = null,
): DirectoryPerson {
  return {
    id: p.id,
    name: nameOf(p),
    email: p.email,
    phone: p.phone,
    role: p.role,
    subtitle,
    districtCode,
  };
}

// Map a role to its short display prefix used in subtitles ("GM Sarah Chen").
const ROLE_PREFIX: Record<string, string> = {
  shift_manager: "SM",
  gm: "GM",
  do: "DO",
  sdo: "SDO",
  rvp: "RVP",
  vp: "VP",
  coo: "COO",
};

function uniq<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    if (!x?.id || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

/** Build the "subtitle" text shown under a person's name in a row. */
function describe(
  p: LeadershipPerson,
  ctx: { storeNumber?: string | null; districtCode?: string | null; storeCount?: number },
): string {
  const role = ROLE_PREFIX[p.role] ?? (p.role || "").toUpperCase();
  if (p.role === "gm" && ctx.storeNumber) {
    return `${role} · SDI ${ctx.storeNumber}`;
  }
  if (p.role === "do" && ctx.districtCode) {
    return ctx.storeCount
      ? `${role} · ${ctx.districtCode} · ${ctx.storeCount} stores`
      : `${role} · ${ctx.districtCode}`;
  }
  if (p.role === "sdo") return `${role} · Senior District Owner`;
  if (p.role === "rvp") return `${role} · Regional VP`;
  if (p.role === "vp")  return `${role} · VP`;
  if (p.role === "coo") return `${role} · Chief Operating Officer`;
  return role;
}

function pinnedTitleFor(role: UserRole | null): string {
  switch (role) {
    case "gm":  return "My district";
    case "do":  return "My team";
    case "sdo": return "My districts";
    case "rvp": return "My region";
    case "vp":
    case "coo":
    case "admin":
      return "Direct reports";
    default:    return "Pinned";
  }
}

export async function fetchDirectory(
  callerRole: UserRole | null,
  callerProfileId: string | null,
): Promise<DirectoryData> {
  const tree: MyTreeResponse = await fetchMyTree();

  // Collect every store row across the tree, alongside the district +
  // region it belongs to. Stores already carry leadership in the
  // leadership lookup so we can attach DO/SDO/RVP/GM later without
  // re-fetching.
  type Flat = {
    storeId: string;
    storeNumber: string;
    storeCity: string | null;
    districtId: string;
    districtCode: string | null;
    regionId: string;
    regionName: string | null;
  };
  const flat: Flat[] = [];
  for (const r of tree.regions) {
    for (const a of r.areas) {
      for (const d of a.districts) {
        for (const s of d.stores) {
          flat.push({
            storeId: s.id,
            storeNumber: s.number,
            storeCity: s.city,
            districtId: d.id,
            districtCode: d.code,
            regionId: r.id,
            regionName: r.name,
          });
        }
      }
    }
  }

  // Count stores per district so we can render "DO · D-14B · 9 stores".
  const storesPerDistrict = new Map<string, number>();
  for (const s of flat) {
    storesPerDistrict.set(s.districtId, (storesPerDistrict.get(s.districtId) ?? 0) + 1);
  }

  // Build per-tier rows.
  const gms: DirectoryPerson[] = [];
  const dos: DirectoryPerson[] = [];
  const sdos: DirectoryPerson[] = [];
  const rvps: DirectoryPerson[] = [];

  // Collect leadership per role, tagging GMs with their store and DOs
  // with their district + store-count for the subtitle.
  for (const s of flat) {
    const L = tree.leadership[s.storeId];
    if (!L) continue;
    if (L.gm) {
      gms.push(toPerson(
        L.gm,
        describe(L.gm, { storeNumber: s.storeNumber }),
        s.districtCode,
      ));
    }
    if (L.do) {
      dos.push(toPerson(
        L.do,
        describe(L.do, { districtCode: s.districtCode, storeCount: storesPerDistrict.get(s.districtId) }),
        s.districtCode,
      ));
    }
    if (L.sdo) {
      sdos.push(toPerson(L.sdo, describe(L.sdo, {}), null));
    }
    if (L.rvp) {
      rvps.push(toPerson(L.rvp, describe(L.rvp, {}), null));
    }
  }

  const distinctGms = uniq(gms);
  const distinctDos = uniq(dos);
  const distinctSdos = uniq(sdos);
  const distinctRvps = uniq(rvps);

  // Above-store = SDO ∪ RVP. VP/COO aren't surfaced via the tree today;
  // they'd be added by a future expansion of the org fetcher.
  const aboveStore = uniq([...distinctSdos, ...distinctRvps]);

  // The pinned section adapts to the caller's role.
  const pinnedPeople = buildPinned(
    callerRole,
    callerProfileId,
    distinctGms,
    distinctDos,
    distinctSdos,
    distinctRvps,
  );

  const scopeLabel = (() => {
    const regions = tree.regions;
    if (regions.length === 1 && regions[0].name) return regions[0].name;
    if (regions.length > 1) return `${regions.length} regions`;
    return "My team";
  })();

  return {
    scopeLabel,
    totalCount: distinctGms.length + distinctDos.length + aboveStore.length,
    pinned: { title: pinnedTitleFor(callerRole), people: pinnedPeople },
    district: distinctGms,
    region: distinctDos,
    aboveStore,
  };
}

/** Pinned section content by role. GMs see their DO + peer GMs; DOs
 *  see their SDO + their reporting GMs; SDOs see their RVP + their
 *  DOs; etc. The exclusion of the caller themselves keeps the row a
 *  list of people they actually talk to, not a mirror with themselves
 *  in it. */
function buildPinned(
  callerRole: UserRole | null,
  callerId: string | null,
  gms: DirectoryPerson[],
  dos: DirectoryPerson[],
  sdos: DirectoryPerson[],
  rvps: DirectoryPerson[],
): DirectoryPerson[] {
  const not = (p: DirectoryPerson) => !callerId || p.id !== callerId;
  switch (callerRole) {
    case "gm":
      // Their DO + a handful of peer GMs. There may be more than one
      // DO if the GM rolls up to multiple — show all.
      return [...dos.filter(not), ...gms.filter(not)].slice(0, 12);
    case "do":
      return [...sdos.filter(not), ...gms.filter(not)].slice(0, 12);
    case "sdo":
      return [...rvps.filter(not), ...dos.filter(not)].slice(0, 12);
    case "rvp":
      // No COO surfaced from the tree yet — show the DOs/SDOs they
      // cover until that's wired.
      return [...sdos.filter(not), ...dos.filter(not)].slice(0, 12);
    case "vp":
    case "coo":
    case "admin":
      return [...rvps.filter(not), ...sdos.filter(not)].slice(0, 12);
    default:
      return [];
  }
}
