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

// PostgREST caps every response at 1000 rows and long `.in()` lists blow up the
// URL, so any query whose result (or filter list) scales with the store count
// must be chunked + paged. Without this, a 271-store org truncates the
// user_scopes fetch below and the district/area/region leader rows fall off the
// end — which is exactly why DO/SDO/RVP came back null (blank column) on the
// labor and GM-roster screens. Chunk the id list, then page each chunk fully.
const IN_CHUNK = 200;
const PAGE = 1000;
async function selectAllIn(supa, table, cols, col, ids, refine) {
  const uniq = [...new Set((ids || []).filter((v) => v !== null && v !== undefined))];
  if (!uniq.length) return [];
  const out = [];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const chunk = uniq.slice(i, i + IN_CHUNK);
    let from = 0;
    for (;;) {
      let q = supa.from(table).select(cols).in(col, chunk).range(from, from + PAGE - 1);
      if (refine) q = refine(q);
      const { data, error } = await q;
      if (error) throw error;
      const batch = data || [];
      out.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
  }
  return out;
}

// Resolve store numbers → our org (store/district/area/region names + the
// responsible GM/DO/SDO/RVP) by walking the hierarchy. Returns a Map keyed by
// store number. Mirrors org.js leadership resolution.
export async function resolveOrg(supa, numbers) {
  const map = new Map();
  if (!numbers.length) return map;
  const stores = await selectAllIn(supa, "stores", "id, number, name, district_id", "number", numbers);

  // GM roster fallback — when a store has no GM account, use the uploaded roster
  // name so every org-driven report (labor, KPI, ranking, …) still shows who the
  // GM is. An actual account always wins; the roster only fills the gap.
  let rosterGm = new Map();
  try {
    const rosterRows = await selectAllIn(supa, "gm_roster", "store_number, gm_name, status", "store_number", numbers.map(String));
    rosterGm = new Map((rosterRows || [])
      .filter((r) => r.status === "named" && r.gm_name)
      .map((r) => [String(r.store_number), r.gm_name]));
  } catch { /* gm_roster may not exist yet */ }
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
  // Primary scopes AND active "additional" (acting) coverage — the same two
  // sources the Org chart's leadership card reads, so an RVP covering an area
  // as acting SDO (e.g. Narda over Area 12) resolves here identically.
  const nowIso = new Date().toISOString();
  const [scopeRows, addlRows] = await Promise.all([
    selectAllIn(supa, "user_scopes", "user_id, scope_type, scope_id", "scope_id", nodeIds),
    selectAllIn(supa, "additional_scopes", "user_id, scope_type, scope_id, expires_at", "scope_id", nodeIds),
  ]);
  const activeAddl = (addlRows || []).filter((r) => !r.expires_at || r.expires_at > nowIso);
  const scopeUserIds = [...new Set([...(scopeRows || []).map((s) => s.user_id), ...activeAddl.map((s) => s.user_id)])];
  const scopeProfiles = await selectAllIn(
    supa, "profiles", "id, full_name, preferred_name, email, role", "id", scopeUserIds,
    (q) => q.eq("is_active", true),
  );
  const gmProfiles = await selectAllIn(
    supa, "profiles", "id, full_name, preferred_name, email, primary_store_id", "primary_store_id", storeIds,
    (q) => q.eq("role", "gm").eq("is_active", true),
  );
  const profById = new Map((scopeProfiles || []).map((p) => [p.id, p]));
  const roleRank = { gm: 1, do: 2, sdo: 3, rvp: 4, vp: 5, coo: 6, admin: 6 };

  // Candidate leaders per node: { role, acting, name, rank }.
  const candByNode = new Map();
  const addCand = (rows, acting) => {
    for (const s of rows || []) {
      const p = profById.get(s.user_id);
      if (!p) continue;
      const role = String(p.role || "").toLowerCase();
      (candByNode.get(s.scope_id) || candByNode.set(s.scope_id, []).get(s.scope_id))
        .push({ role, acting, name: nameOf(p), rank: roleRank[role] ?? 0 });
    }
  };
  addCand(scopeRows, false);
  addCand(activeAddl, true);

  // Node leader, mirroring org.js findManager: primary exact-role, then acting
  // exact-role, then most-senior primary, then most-senior acting. This is
  // what puts an RVP-as-acting-SDO into the area's SDO slot.
  const leadOf = (id, expectedRole) => {
    const cs = candByNode.get(id);
    if (!cs || !cs.length) return null;
    const bySenior = (a, b) => b.rank - a.rank;
    const pick =
      cs.find((c) => !c.acting && c.role === expectedRole) ||
      cs.find((c) => c.acting && c.role === expectedRole) ||
      [...cs.filter((c) => !c.acting)].sort(bySenior)[0] ||
      [...cs.filter((c) => c.acting)].sort(bySenior)[0];
    return pick?.name ?? null;
  };
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
      gmName: gmByStore.get(s.id) || leadOf(s.id, "gm") || rosterGm.get(String(s.number)) || null,
      district: d?.name ?? null,
      doName: d ? leadOf(d.id, "do") : null,
      area: a?.name ?? null,
      sdoName: a ? leadOf(a.id, "sdo") : null,
      region: r?.name ?? null,
      rvpName: r ? leadOf(r.id, "rvp") : null,
    });
  }
  return map;
}
