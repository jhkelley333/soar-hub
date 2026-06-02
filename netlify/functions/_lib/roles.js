// Shared role helpers for Netlify functions.
//
// The hourly store-floor roles all share Shift Manager's permission tier
// (see migration 0119). Any code that asks "is this a store-floor hourly
// user?" must test membership in HOURLY_STORE_ROLES rather than comparing
// to "shift_manager" alone, or the newer titles get silently excluded.

export const HOURLY_STORE_ROLES = new Set([
  "shift_manager",
  "first_assistant_manager",
  "associate_manager",
  "crew_leader",
  "crew_member",
  "carhop",
]);

// True for any hourly store role (shift_manager + the five title roles).
export function isHourlyStoreRole(role) {
  return HOURLY_STORE_ROLES.has(String(role || "").toLowerCase());
}

// True for a single-store user: an hourly store role OR a GM. These are the
// roles whose visible scope is exactly one store, used across the functions
// to branch single-store vs. multi-store behavior.
export function isSingleStoreRole(role) {
  const r = String(role || "").toLowerCase();
  return r === "gm" || HOURLY_STORE_ROLES.has(r);
}
