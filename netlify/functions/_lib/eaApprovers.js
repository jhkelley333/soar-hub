// Employee Action approver resolution — shared by the employee-actions function
// (routing + on-submit notify) and the daily approvals-reminder report, so both
// resolve "who approves this" the same way. Routing is by role + org scope:
// primary scope holders (user_scopes) whose role matches the tier, plus active
// acting coverers (additional_scopes, non-expired) regardless of primary role.

// Resolve the active profiles holding `role` whose scope row matches the given
// org scope (district/area/region). Returns { id, email, full_name, preferred_name }.
export async function scopedProfiles(supa, scopeType, scopeId, role) {
  if (!scopeId) return [];
  const nowIso = new Date().toISOString();
  const [{ data: primaryScoped }, { data: actingScoped }] = await Promise.all([
    supa.from("user_scopes").select("user_id").eq("scope_type", scopeType).eq("scope_id", scopeId),
    supa.from("additional_scopes").select("user_id, expires_at").eq("scope_type", scopeType).eq("scope_id", scopeId),
  ]);
  const activeActing = (actingScoped ?? []).filter((r) => !r.expires_at || r.expires_at > nowIso);
  const ids = Array.from(
    new Set([
      ...(primaryScoped ?? []).map((s) => s.user_id),
      ...activeActing.map((s) => s.user_id),
    ]),
  );
  if (!ids.length) return [];
  const { data: profiles } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role")
    .in("id", ids)
    .eq("is_active", true);
  const primaryIds = new Set((primaryScoped ?? []).map((s) => s.user_id));
  const actingIds = new Set(activeActing.map((s) => s.user_id));
  const out = [];
  for (const p of profiles ?? []) {
    const primaryMatch = primaryIds.has(p.id) && p.role === role;
    if (primaryMatch || actingIds.has(p.id)) {
      out.push({ id: p.id, email: p.email, full_name: p.full_name, preferred_name: p.preferred_name });
    }
  }
  return out;
}

// Given a store number, resolve the DO (district scope), SDO (area scope), and
// RVP (region scope) responsible for it. Same scope-walk org.js findManager() uses.
export async function resolveStoreLeadership(supa, storeNumber) {
  const out = { dos: [], sdos: [], rvps: [] };
  const { data: store } = await supa
    .from("stores").select("id, district_id").eq("number", storeNumber).maybeSingle();
  if (!store?.district_id) return out;

  out.dos = await scopedProfiles(supa, "district", store.district_id, "do");

  const { data: district } = await supa
    .from("districts").select("id, area_id").eq("id", store.district_id).maybeSingle();
  if (!district?.area_id) return out;

  out.sdos = await scopedProfiles(supa, "area", district.area_id, "sdo");

  const { data: area } = await supa
    .from("areas").select("id, region_id").eq("id", district.area_id).maybeSingle();
  if (area?.region_id) {
    out.rvps = await scopedProfiles(supa, "region", area.region_id, "rvp");
  }
  return out;
}

// The profiles one level UP the org from `profile` — their next-level leader.
// Store roles (GM + crew) → the store's DO; DO → the district's SDO; SDO → the
// area's RVP; RVP/VP → COO/VP. Resolution is keyed to the submitter's role
// first, then falls back to the deepest scope they actually hold. Best-effort:
// returns [] (never throws) when it can't resolve a level up.
// `profile` needs at least { id, role }; primary_store_id is used when present
// and looked up otherwise.
export async function resolveNextLevelLeader(supa, profile) {
  if (!profile?.id) return [];
  const role = String(profile.role || "").toLowerCase();
  const nowIso = new Date().toISOString();

  const [{ data: scopes }, { data: addl }] = await Promise.all([
    supa.from("user_scopes").select("scope_type, scope_id").eq("user_id", profile.id),
    supa.from("additional_scopes").select("scope_type, scope_id, expires_at").eq("user_id", profile.id),
  ]);
  const active = [
    ...(scopes ?? []),
    ...((addl ?? []).filter((r) => !r.expires_at || r.expires_at > nowIso)),
  ];
  const scopeOf = (t) => active.find((s) => s.scope_type === t)?.scope_id || null;

  let primaryStoreId = profile.primary_store_id ?? null;
  if (primaryStoreId == null && profile.primary_store_id === undefined) {
    const { data: p } = await supa.from("profiles").select("primary_store_id").eq("id", profile.id).maybeSingle();
    primaryStoreId = p?.primary_store_id ?? null;
  }

  const coosVps = async () => {
    const { data } = await supa
      .from("profiles").select("id, email, full_name, preferred_name")
      .in("role", ["coo", "vp"]).eq("is_active", true);
    return (data ?? []).map((p) => ({ id: p.id, email: p.email, full_name: p.full_name, preferred_name: p.preferred_name }));
  };
  const sdoOfDistrict = async (districtId) => {
    if (!districtId) return [];
    const { data: d } = await supa.from("districts").select("area_id").eq("id", districtId).maybeSingle();
    return d?.area_id ? scopedProfiles(supa, "area", d.area_id, "sdo") : [];
  };
  const rvpOfArea = async (areaId) => {
    if (!areaId) return [];
    const { data: a } = await supa.from("areas").select("region_id").eq("id", areaId).maybeSingle();
    return a?.region_id ? scopedProfiles(supa, "region", a.region_id, "rvp") : [];
  };
  const doOfStore = async (storeId) => {
    if (!storeId) return [];
    const { data: s } = await supa.from("stores").select("district_id").eq("id", storeId).maybeSingle();
    return s?.district_id ? scopedProfiles(supa, "district", s.district_id, "do") : [];
  };

  // Role-keyed: a leader escalates up their own tier.
  if (role === "rvp" || role === "vp") return coosVps();
  if (role === "sdo") return rvpOfArea(scopeOf("area"));
  if (role === "do") return sdoOfDistrict(scopeOf("district"));

  // Store-level (GM + crew) or anyone tied to a store → the store's DO.
  const storeId = scopeOf("store") || primaryStoreId;
  if (storeId) {
    const dos = await doOfStore(storeId);
    if (dos.length) return dos;
  }
  // Fallback by the deepest scope the submitter holds.
  if (scopeOf("district")) return sdoOfDistrict(scopeOf("district"));
  if (scopeOf("area")) return rvpOfArea(scopeOf("area"));
  if (scopeOf("region")) return coosVps();
  return [];
}
