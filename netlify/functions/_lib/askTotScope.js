// Scope helper for Ask Tot — single source of truth for visibility.
// Every tool handler calls resolveAskScope() once and passes the result
// to inScope() for each row it would surface to the model.
//
// resolveAskScope(supa, profile) → { role, orgWide, storeNumbers: Set<string>|null }
// inScope(scope, storeNumber)   → boolean

const ORG_WIDE_ROLES = new Set(["admin", "coo", "vp"]);

/**
 * Resolve what stores the caller can see.
 * Uses user_visible_stores() — the same RPC as employee-actions.js / paf.js.
 */
export async function resolveAskScope(supa, profile) {
  if (ORG_WIDE_ROLES.has(profile.role)) {
    return { role: profile.role, orgWide: true, storeNumbers: null };
  }

  const { data: visibleIds } = await supa.rpc("user_visible_stores", { uid: profile.id });
  const ids = (visibleIds ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);

  if (!ids.length) {
    return { role: profile.role, orgWide: false, storeNumbers: new Set() };
  }

  // Map UUIDs → store numbers; exclude Apricus (Little Caesars) rows
  const { data: stores } = await supa
    .from("stores")
    .select("number")
    .in("id", ids)
    .or("brand.eq.sonic,brand.is.null")
    .eq("is_active", true);

  return {
    role: profile.role,
    orgWide: false,
    storeNumbers: new Set((stores ?? []).map((s) => String(s.number))),
  };
}

/**
 * Is storeNumber within scope?
 * storeNumber may be a string or number; always coerced to string.
 */
export function inScope(scope, storeNumber) {
  return scope.orgWide || scope.storeNumbers.has(String(storeNumber));
}
