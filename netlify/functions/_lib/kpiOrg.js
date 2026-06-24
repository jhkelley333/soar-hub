// Shared helpers for mapping the KPI feed onto the SOAR org hierarchy.

// The feed's storeName is "<store#> <name>" (e.g. "3574 Helton Dr"); the leading
// digits are our store number — the join key into stores → districts → areas →
// regions.
export function storeNumberOf(r) {
  const m = String(r?.storeName || "").match(/^\s*(\d+)/);
  return m ? m[1] : null;
}

// A businessDateData row is store-level when its storeName isn't the "Total"
// roll-up the feed emits at each parent level.
export function isStoreRow(r) {
  return Boolean(r?.storeName && r.storeName !== "Total");
}

// Resolve store numbers → our org (store/district/area/region names + the
// responsible GM/DO/SDO/RVP) by walking the hierarchy. Returns a Map keyed by
// store number. Mirrors org.js leadership resolution.
export async function resolveOrg(supa, numbers) {
  const map = new Map();
  if (!numbers.length) return map;
  const { data: stores } = await supa.from("stores").select("id, number, name, district_id").in("number", numbers);
  const storeIds = [...new Set((stores || []).map((s) => s.id).filter(Boolean))];
  const districtIds = [...new Set((stores || []).map((s) => s.district_id).filter(Boolean))];
  const { data: districts } = districtIds.length
    ? await supa.from("districts").select("id, name, area_id").in("id", districtIds) : { data: [] };
  const areaIds = [...new Set((districts || []).map((d) => d.area_id).filter(Boolean))];
  const { data: areas } = areaIds.length
    ? await supa.from("areas").select("id, name, region_id").in("id", areaIds) : { data: [] };
  const regionIds = [...new Set((areas || []).map((a) => a.region_id).filter(Boolean))];
  const { data: regions } = regionIds.length
    ? await supa.from("regions").select("id, name").in("id", regionIds) : { data: [] };

  const nameOf = (p) => (p ? p.preferred_name || p.full_name || p.email || null : null);
  const nodeIds = [...storeIds, ...districtIds, ...areaIds, ...regionIds];
  const { data: scopeRows } = nodeIds.length
    ? await supa.from("user_scopes").select("user_id, scope_type, scope_id").in("scope_id", nodeIds) : { data: [] };
  const scopeUserIds = [...new Set((scopeRows || []).map((s) => s.user_id))];
  const { data: scopeProfiles } = scopeUserIds.length
    ? await supa.from("profiles").select("id, full_name, preferred_name, email, role").in("id", scopeUserIds).eq("is_active", true) : { data: [] };
  const { data: gmProfiles } = storeIds.length
    ? await supa.from("profiles").select("id, full_name, preferred_name, email, primary_store_id").eq("role", "gm").eq("is_active", true).in("primary_store_id", storeIds) : { data: [] };
  const profById = new Map((scopeProfiles || []).map((p) => [p.id, p]));
  const expectedRole = { district: "do", area: "sdo", region: "rvp", store: "gm" };
  const leaderByNode = new Map();
  for (const s of scopeRows || []) {
    const p = profById.get(s.user_id);
    if (p && String(p.role || "").toLowerCase() === expectedRole[s.scope_type] && !leaderByNode.has(s.scope_id)) {
      leaderByNode.set(s.scope_id, nameOf(p));
    }
  }
  const gmByStore = new Map();
  for (const p of gmProfiles || []) if (p.primary_store_id) gmByStore.set(p.primary_store_id, nameOf(p));

  const dMap = new Map((districts || []).map((d) => [d.id, d]));
  const aMap = new Map((areas || []).map((a) => [a.id, a]));
  const rMap = new Map((regions || []).map((r) => [r.id, r]));
  for (const s of stores || []) {
    const d = dMap.get(s.district_id) || null;
    const a = d ? aMap.get(d.area_id) || null : null;
    const r = a ? rMap.get(a.region_id) || null : null;
    map.set(String(s.number), {
      number: String(s.number),
      store: s.name || `#${s.number}`,
      gmName: gmByStore.get(s.id) || leaderByNode.get(s.id) || null,
      district: d?.name ?? null,
      doName: d ? leaderByNode.get(d.id) || null : null,
      area: a?.name ?? null,
      sdoName: a ? leaderByNode.get(a.id) || null : null,
      region: r?.name ?? null,
      rvpName: r ? leaderByNode.get(r.id) || null : null,
    });
  }
  return map;
}
