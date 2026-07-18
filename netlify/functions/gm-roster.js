// GM roster reconciliation. The gm_roster table is the authoritative "who is the
// GM" per store (seeded from the ops sheet, editable via import). This function
// compares each roster entry to the actual GM account on that store and reports
// a reconcile status: matched / no_account / mismatch / open / in_training — so
// admins can see who still needs an account or whose name doesn't line up.
//
//   GET  ?action=list                 -> every store's roster + account status
//   POST ?action=import  {rows:[...]} -> upsert roster rows (paste importer)
//
// Service-role gatekeeper: RLS on gm_roster, no policies; this function checks
// the caller's role. Read/import limited to above-store leadership.

import { createClient } from "@supabase/supabase-js";
import { resolveOrg } from "./_lib/kpiOrg.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MANAGE_ROLES = new Set(["admin", "vp", "coo"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("gm-roster env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles").select("id, email, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const displayName = (p) => (p ? p.preferred_name || p.full_name || p.email || null : null);

// Loose name equality: case-insensitive, punctuation-stripped, and order-
// independent on first/last so "Eduardo Escalera II" ≈ "Eduardo Escalera" and
// middle names don't trip it. Anything that doesn't line up is a mismatch to
// eyeball — deliberately conservative since it only flags, never edits.
function normName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function namesMatch(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(" "), tb = nb.split(" ");
  const firstLast = (t) => (t.length >= 2 ? `${t[0]} ${t[t.length - 1]}` : t[0]);
  return firstLast(ta) === firstLast(tb);
}

// GM account per store id — the same two sources of truth org.js unions:
// profiles.primary_store_id (preferred) then user_scopes store-scope holders.
async function gmAccountsByStore(supa, storeIds) {
  const byStore = new Map();
  if (!storeIds.length) return byStore;
  const { data: scopeRows } = await supa.from("user_scopes").select("user_id, scope_type, scope_id").eq("scope_type", "store").in("scope_id", storeIds);
  const scopeUserIds = [...new Set((scopeRows || []).map((r) => r.user_id))];
  const { data: primaries } = await supa.from("profiles")
    .select("id, full_name, preferred_name, email, role, primary_store_id, is_active")
    .eq("role", "gm").eq("is_active", true).in("primary_store_id", storeIds);
  const { data: scopedProfiles } = scopeUserIds.length
    ? await supa.from("profiles").select("id, full_name, preferred_name, email, role, is_active").eq("role", "gm").eq("is_active", true).in("id", scopeUserIds)
    : { data: [] };
  const scopedById = new Map((scopedProfiles || []).map((p) => [p.id, p]));
  // Source (2): scope-based GMs first, so primary_store_id can overwrite.
  for (const r of scopeRows || []) {
    const p = scopedById.get(r.user_id);
    if (p) byStore.set(r.scope_id, p);
  }
  for (const p of primaries || []) byStore.set(p.primary_store_id, p);
  return byStore;
}

async function listRoster(supa, user) {
  if (!MANAGE_ROLES.has(String(user.role).toLowerCase())) return { error: "forbidden", status: 403 };
  const [{ data: roster }, { data: stores }] = await Promise.all([
    supa.from("gm_roster").select("*").order("store_number"),
    supa.from("stores").select("id, number, name"),
  ]);
  const storeByNumber = new Map((stores || []).map((s) => [String(s.number), s]));
  const numbers = (roster || []).map((r) => String(r.store_number));
  const [gmByStore, orgMap] = await Promise.all([
    gmAccountsByStore(supa, (stores || []).map((s) => s.id)),
    resolveOrg(supa, numbers),
  ]);

  const rows = (roster || []).map((r) => {
    const num = String(r.store_number);
    const store = storeByNumber.get(num) || null;
    const acct = store ? gmByStore.get(store.id) || null : null;
    const account = acct ? { name: displayName(acct), email: acct.email } : null;
    const org = orgMap.get(num) || {};
    let reconcile;
    if (r.status === "open" || r.status === "in_training") reconcile = r.status;
    else if (!account) reconcile = "no_account";
    else if (namesMatch(r.gm_name, account.name)) reconcile = "matched";
    else reconcile = "mismatch";
    return {
      store_number: num,
      store_name: r.store_name || store?.name || null,
      in_app: !!store,
      roster_name: r.gm_name,
      roster_status: r.status,
      gm_email: r.gm_email, gm_cell: r.gm_cell, gm_birthday: r.gm_birthday,
      hire_date: r.hire_date, placement_date: r.placement_date,
      do_name: org.doName ?? null, sdo_name: org.sdoName ?? null, rvp_name: org.rvpName ?? null,
      account,
      reconcile,
    };
  });

  const summary = { matched: 0, no_account: 0, mismatch: 0, open: 0, in_training: 0 };
  for (const r of rows) summary[r.reconcile] = (summary[r.reconcile] || 0) + 1;
  return { rows, summary };
}

async function importRoster(supa, user, body) {
  if (!MANAGE_ROLES.has(String(user.role).toLowerCase())) return { error: "forbidden", status: 403 };
  const input = Array.isArray(body?.rows) ? body.rows : [];
  if (!input.length) return { error: "no rows to import", status: 400 };
  if (input.length > 1000) return { error: "too many rows in one import", status: 400 };
  const now = new Date().toISOString();
  const ready = [];
  for (const r of input) {
    const num = String(r.store_number || "").trim();
    if (!num) continue;
    const gmRaw = String(r.gm_name || "").trim();
    let status = "named", gm = gmRaw;
    if (!gmRaw) { status = "open"; gm = null; }
    else if (/^open$/i.test(gmRaw)) { status = "open"; gm = null; }
    else if (/in\s*training/i.test(gmRaw)) { status = "in_training"; gm = null; }
    ready.push({
      store_number: num,
      store_name: r.store_name ? String(r.store_name).trim() : null,
      gm_name: gm,
      status,
      gm_email: r.gm_email ? String(r.gm_email).trim() : null,
      gm_cell: r.gm_cell ? String(r.gm_cell).trim() : null,
      gm_birthday: r.gm_birthday ? String(r.gm_birthday).trim() : null,
      hire_date: r.hire_date ? String(r.hire_date).trim() : null,
      placement_date: r.placement_date ? String(r.placement_date).trim() : null,
      updated_by: user.id,
      updated_at: now,
    });
  }
  if (!ready.length) return { error: "nothing parseable", status: 400 };
  const { error } = await supa.from("gm_roster").upsert(ready, { onConflict: "store_number" });
  if (error) return { error: error.message, status: 500 };
  return { ok: true, upserted: ready.length };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getSessionUser(supa, event);
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "";
  const unwrap = (out) => (out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out }));

  try {
    if (event.httpMethod === "GET" && action === "list") return unwrap(await listRoster(supa, user));
    if (event.httpMethod === "POST" && action === "import") {
      const body = event.body ? JSON.parse(event.body) : {};
      return unwrap(await importRoster(supa, user, body));
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("[gm-roster]", action, e?.message || e);
    return respond(500, { error: e?.message || "server error" });
  }
};
