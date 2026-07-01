// netlify/functions/_lib/pafWatchers.js
//
// SDO/RVP/VP/COO can opt in (profiles.notify_paf_downline, migration 0207)
// to being copied on PAF submission + discussion emails for PAFs in their
// own downline. SDO/RVP are scoped to their assigned area/region (walking
// store -> district -> area -> region via user_scopes, same pattern as
// findUsersForStore in ticketEmail.js and resolveBonusApprover in paf.js).
// VP/COO's downline is the whole company, so no scope check for them.
//
// Shared by paf.js (the initial submission alert) and chat.js (every
// "Message the submitter" email) so both honor the same opt-in list.

export async function resolvePafWatchers(supabase, storeNumber) {
  const watchers = new Map();

  // VP / COO — company-wide downline, no scope check.
  const { data: orgWide } = await supabase
    .from("profiles")
    .select("id, email, full_name, preferred_name, role")
    .in("role", ["vp", "coo"])
    .eq("is_active", true)
    .eq("notify_paf_downline", true);
  for (const p of orgWide || []) watchers.set(p.id, p);

  if (!storeNumber) return Array.from(watchers.values());

  const { data: store } = await supabase
    .from("stores")
    .select("id, district_id")
    .eq("number", String(storeNumber))
    .maybeSingle();

  const scopeIds = [];
  if (store?.district_id) {
    scopeIds.push(store.district_id);
    const { data: district } = await supabase
      .from("districts")
      .select("area_id")
      .eq("id", store.district_id)
      .maybeSingle();
    if (district?.area_id) {
      scopeIds.push(district.area_id);
      const { data: area } = await supabase
        .from("areas")
        .select("region_id")
        .eq("id", district.area_id)
        .maybeSingle();
      if (area?.region_id) scopeIds.push(area.region_id);
    }
  }
  if (!scopeIds.length) return Array.from(watchers.values());

  // SDO / RVP — scoped to the PAF's store's area/region.
  const { data: candidates } = await supabase
    .from("profiles")
    .select("id, email, full_name, preferred_name, role")
    .in("role", ["sdo", "rvp"])
    .eq("is_active", true)
    .eq("notify_paf_downline", true);
  const candidateIds = (candidates || []).map((p) => p.id);
  if (candidateIds.length) {
    const { data: scopes } = await supabase
      .from("user_scopes")
      .select("user_id")
      .in("scope_id", scopeIds)
      .in("user_id", candidateIds);
    const inScope = new Set((scopes || []).map((s) => s.user_id));
    for (const p of candidates || []) {
      if (inScope.has(p.id)) watchers.set(p.id, p);
    }
  }

  return Array.from(watchers.values());
}
