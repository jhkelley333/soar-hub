// Talent Pipeline ↔ account sync.
//
// The pipeline roster (tp_team_members) is mostly the ATS store roster — rows
// with no app login (profile_id null). But manager/GM seats ARE app accounts,
// and those must track My Team: when an account is terminated, transferred, or
// reassigned, its pipeline seat has to follow, or the ladder goes stale (a
// terminated GM keeps holding a seat, a new GM shows "no one in this seat").
//
// This module keeps ONLY profile-linked rows in lockstep with their profile.
// Rows with profile_id null (ATS / no-login crew) are never touched. It's
// called two ways: inline from team-mgmt writes (real-time), and from a nightly
// reconcile that catches any other write path (Org Admin, GM Roster, bulk).

// SOAR auth role → ladder role key (same mapping team-pipeline.js uses).
export const TP_ROLE_MAP = {
  gm: "gm", first_assistant_manager: "fam", associate_manager: "assoc",
  crew_leader: "lead", shift_manager: "shift", crew_member: "crew", carhop: "carhop",
};

// The store a profile belongs to: primary_store_id first (what PAF, birthdays,
// and team-members key off), else a user_scopes store row (what the Org Admin
// tree writes). Mirrors the GM union in org.js so the pipeline agrees with My
// Team about who's where.
// Loose name equality (order-independent first/last, punctuation-stripped) —
// same rule gm-roster.js uses to match an account to a roster entry.
function normName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function namesMatch(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const first = (t) => (t.length >= 2 ? `${t[0]} ${t[t.length - 1]}` : t[0]);
  return first(na.split(" ")) === first(nb.split(" "));
}

async function storeForProfile(supa, profile) {
  if (profile.primary_store_id) return profile.primary_store_id;
  const { data } = await supa
    .from("user_scopes").select("scope_id")
    .eq("user_id", profile.id).eq("scope_type", "store").limit(1);
  if (data && data.length) return data[0].scope_id;

  // GM-roster fallback: a GM account can be tied to its store only through the
  // roster (the authoritative who's-GM-per-store), matched by email then name,
  // with no primary_store_id / user_scopes row. Resolve store_number -> id.
  if (String(profile.role) === "gm") {
    const email = String(profile.email || "").toLowerCase();
    const acctName = profile.preferred_name || profile.full_name || "";
    const { data: roster } = await supa.from("gm_roster").select("store_number, gm_name, gm_email");
    let storeNumber = null;
    for (const r of roster || []) {
      if (email && String(r.gm_email || "").toLowerCase() === email) { storeNumber = r.store_number; break; }
    }
    if (!storeNumber) {
      for (const r of roster || []) {
        if (r.gm_name && namesMatch(r.gm_name, acctName)) { storeNumber = r.store_number; break; }
      }
    }
    if (storeNumber) {
      const { data: st } = await supa.from("stores").select("id").eq("number", String(storeNumber)).maybeSingle();
      if (st) return st.id;
    }
  }
  return null;
}

// Reconcile one profile's pipeline seat with the live account. Best-effort:
// callers should swallow errors so an account write never fails on pipeline
// sync — the nightly reconcile is the backstop.
export async function syncProfileToRoster(supa, profileId) {
  if (!profileId) return { ok: false, reason: "no-profile" };
  const { data: p } = await supa
    .from("profiles")
    .select("id, full_name, preferred_name, email, role, is_active, primary_store_id")
    .eq("id", profileId).maybeSingle();
  if (!p) return { ok: false, reason: "not-found" };

  const rk = TP_ROLE_MAP[String(p.role)];
  const storeId = rk ? await storeForProfile(supa, p) : null;
  const { data: rowsRaw } = await supa
    .from("tp_team_members").select("id, store_id, role, status, full_name, email").eq("profile_id", p.id);
  const linked = rowsRaw || [];

  // Off the store floor now — deactivated, promoted to a non-ladder role (DO+),
  // or no store. Terminate every linked seat so it empties.
  if (!p.is_active || !rk || !storeId) {
    let changed = 0;
    for (const r of linked) {
      if (r.status !== "terminated") {
        const { error } = await supa.from("tp_team_members").update({ status: "terminated" }).eq("id", r.id);
        if (!error) changed++;
      }
    }
    return { ok: true, action: "terminated", changed };
  }

  // Active account with a store + ladder role. Keep one seat in sync (store =
  // transfers, role = promotions, status = reactivation, name/email from the
  // account). If legacy data linked several rows, keep one and terminate the
  // rest so a profile never holds two live seats.
  const name = p.preferred_name || p.full_name || p.email || "Team member";
  if (linked.length === 0) {
    const { error } = await supa.from("tp_team_members").insert({
      store_id: storeId, profile_id: p.id, role: rk, status: "active", full_name: name, email: p.email,
    });
    return { ok: !error, action: "created" };
  }
  const keep = linked.find((r) => r.status !== "terminated") || linked[0];
  // Only write when something actually differs — keeps the nightly sweep from
  // bumping updated_at on every account-linked row every run.
  let error = null;
  const changed =
    keep.store_id !== storeId || keep.role !== rk || keep.status !== "active" ||
    (keep.full_name ?? null) !== name || (keep.email ?? null) !== (p.email ?? null);
  if (changed) {
    ({ error } = await supa.from("tp_team_members").update({
      store_id: storeId, role: rk, status: "active", full_name: name, email: p.email,
    }).eq("id", keep.id));
  }
  let extra = 0;
  for (const r of linked) {
    if (r.id !== keep.id && r.status !== "terminated") {
      await supa.from("tp_team_members").update({ status: "terminated" }).eq("id", r.id);
      extra++;
    }
  }
  return { ok: !error, action: changed ? "synced" : "unchanged", extra_terminated: extra };
}

// Full sweep: every profile that could hold a seat (a ladder role) plus every
// profile that currently owns a linked row (so deactivations terminate too).
// Idempotent — safe to run on a schedule or behind an admin button.
export async function reconcileAllProfiles(supa) {
  const { data: mapped } = await supa
    .from("profiles").select("id").in("role", Object.keys(TP_ROLE_MAP));
  const { data: linkedRows } = await supa
    .from("tp_team_members").select("profile_id").not("profile_id", "is", null);
  const ids = new Set();
  for (const p of mapped || []) ids.add(p.id);
  for (const r of linkedRows || []) if (r.profile_id) ids.add(r.profile_id);

  const tally = { created: 0, updated: 0, closed: 0, unchanged: 0, failed: 0 };
  for (const id of ids) {
    try {
      const r = await syncProfileToRoster(supa, id);
      if (r?.action === "created") tally.created++;
      else if (r?.action === "synced") tally.updated++;
      else if (r?.action === "terminated" && r.changed > 0) tally.closed += r.changed;
      else tally.unchanged++;
    } catch { tally.failed++; }
  }
  return { ok: true, profiles: ids.size, ...tally };
}
