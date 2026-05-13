// Feature-flag resolver. Single function any other netlify function
// can import. Returns boolean — defaults to false when the row is
// missing, so a forgotten seed never accidentally exposes new code.
//
// Resolution order:
//   1. row.enabled = true              → on for everyone
//   2. storeNumber in allowlist_stores → on for this caller
//   3. userId in allowlist_user_ids    → on for this caller
//   4. otherwise                       → off

export async function getFlag(supa, key, { storeNumber, userId } = {}) {
  if (!supa || !key) return false;
  const { data, error } = await supa
    .from("feature_flags")
    .select("enabled, allowlist_stores, allowlist_user_ids")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return false;
  if (data.enabled === true) return true;
  if (storeNumber && Array.isArray(data.allowlist_stores)
      && data.allowlist_stores.includes(String(storeNumber))) {
    return true;
  }
  if (userId && Array.isArray(data.allowlist_user_ids)
      && data.allowlist_user_ids.includes(userId)) {
    return true;
  }
  return false;
}

// Bulk resolver. Used by the frontend's resolveAll endpoint so the
// client never has to think about allowlists — server returns the
// already-resolved boolean per key for the calling user.
export async function resolveAll(supa, { storeNumber, userId } = {}) {
  const { data, error } = await supa
    .from("feature_flags")
    .select("key, enabled, allowlist_stores, allowlist_user_ids");
  if (error || !data) return {};
  const out = {};
  for (const row of data) {
    let on = row.enabled === true;
    if (!on && storeNumber && Array.isArray(row.allowlist_stores)) {
      on = row.allowlist_stores.includes(String(storeNumber));
    }
    if (!on && userId && Array.isArray(row.allowlist_user_ids)) {
      on = row.allowlist_user_ids.includes(userId);
    }
    out[row.key] = on;
  }
  return out;
}
