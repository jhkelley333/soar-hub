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
