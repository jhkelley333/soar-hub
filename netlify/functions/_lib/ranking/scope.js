// Scope the ranking read path to what a caller manages — mirrors the rest of
// the Hub (org.js `callerVisibleStoreIds` + the `user_visible_stores` RPC).
//
//   Org-wide roles (payroll / admin / vp / coo) see everything, including the
//   Company and Entity roll-ups.
//   Everyone else sees only: their own stores, their own leader row, and the
//   leaders in their chain of command (derived by name from their stores).
//
// The store-number set is the anchor; leader rows are keyed by name, so we
// read the run's store rows once and collect the DO / SDO / RVP / entity names
// that sit above the caller's visible stores.

const ORG_WIDE = new Set(["payroll", "admin", "vp", "coo"]);

export const isOrgWide = (user) => ORG_WIDE.has(String(user?.role || "").toLowerCase());

// null  -> unrestricted (whole company; Company + Entity tiers included).
// Set   -> the store NUMBERS the caller manages (empty set = sees nothing).
export async function callerStoreNumbers(supa, user) {
  if (isOrgWide(user)) return null;
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return new Set();
  const nums = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supa.from("stores").select("number").in("id", ids.slice(i, i + 500));
    for (const s of data || []) nums.add(String(s.number));
  }
  return nums;
}

// From a run's STORE rows (metrics carry doName/sdoName/rvpName/entity) and the
// caller's store-number set, collect the leader names/entities in their chain.
export function deriveVisibleNames(storeRows, storeNums) {
  const dos = new Set(), sdos = new Set(), rvps = new Set(), ents = new Set();
  for (const r of storeRows || []) {
    if (!storeNums.has(String(r.entity_key))) continue;
    const m = r.metrics || {};
    if (m.doName) dos.add(String(m.doName));
    if (m.sdoName) sdos.add(String(m.sdoName));
    if (m.rvpName) rvps.add(String(m.rvpName));
    if (m.entity) ents.add(String(m.entity));
  }
  return { dos, sdos, rvps, ents };
}

// Keep only the rows a scoped caller may see. `storeNums == null` (org-wide)
// passes everything through. Company + Entity roll-ups are exec-level: a
// scoped caller never sees them (they aggregate beyond the caller's reach).
export function filterTier(rows, tier, storeNums, vis) {
  if (storeNums == null) return rows;
  switch (tier) {
    case "store": return rows.filter((r) => storeNums.has(String(r.entity_key)));
    case "do":    return rows.filter((r) => vis.dos.has(String(r.entity_key)));
    case "sdo":   return rows.filter((r) => vis.sdos.has(String(r.entity_key)));
    case "rvp":   return rows.filter((r) => vis.rvps.has(String(r.entity_key)));
    case "entity":
    case "company": return [];
    default: return [];
  }
}
