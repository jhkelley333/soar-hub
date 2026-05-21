// netlify/functions/facilities-v2.js
//
// Work Orders V2 (Facilities V2) — Supabase Bearer-JWT auth, bare-name
// tables, wo2-ticket-photos bucket (public). Lives on the
// claude/work-orders-v2 branch.
//
// Email notifications via Resend (REST API, no extra dep):
//   * createTicket       → notifies GM + DO with scope over the store
//   * submitApproval     → notifies users whose role matches the tier
//                          (DO < $500 → role 'do', SDO… → 'sdo', VP… → 'vp')
//   * decideApproval     → notifies the original requester
// Each send also writes a row into ticket_notifications so the audit
// log shows who got what.
//
// Templates: admin-editable rows in `email_templates` keyed by `kind`.
// `{{variable}}` placeholders get replaced with html-escaped values at
// send-time. If the row is missing or inactive the function falls back
// to a hardcoded default so a broken template doesn't stop sends.
//
// Required env vars:
//   SUPABASE_URL / VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY
//   RESEND_API_KEY                          — same key PAF already uses
//   FACILITIES_FROM_EMAIL                   — defaults to PAF's address
//   FACILITIES_FROM_NAME                    — default "SOAR Facilities"
//   APP_URL                                 — base URL for deep links;
//                                             Netlify exposes URL by default

import { createClient } from "@supabase/supabase-js";
import { can, requireCap, tierFor, activityVisibilityForTier } from "./_lib/permissions.js";
import { transition, setPause, isWithinReopenGrace, REOPEN_GRACE } from "./_lib/ticketStateMachine.js";
import { toNewStatus, toLegacyStatus } from "./_lib/statusMapping.js";
import { sendEmail, notifyTicketEvent } from "./_lib/ticketEmail.js";
import { onPMTicketClosed } from "./_lib/pm.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const PHOTOS_BUCKET = "wo2-ticket-photos";

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getCallerProfile(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = getSupabase();
  const { data: userRes } = await supa.auth.getUser(token);
  if (!userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function roleLevel(role) {
  const levels = {
    admin: 1, coo: 1, vp: 1,
    rvp: 2, sdo: 2,
    do: 3,
    gm: 4,
    shift_manager: 5,
    payroll: 6,
  };
  return levels[String(role || "").toLowerCase()] || 99;
}

// Tiny helpers for warranty fields. Lenient on input — empty
// strings, whitespace, garbage all become null instead of NaN.
function parseIntOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Accepts vendor / manufacturer / mfg / mfr / none — case-insensitive.
// Anything else returns null so the CHECK constraint isn't tripped.
function normalizeWarrantySource(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === "vendor")                                       return "vendor";
  if (s === "manufacturer" || s === "mfg" || s === "mfr" ||
      s === "manufacturer pass-through" || s === "pass-through" ||
      s === "passthrough")                                  return "manufacturer";
  if (s === "none")                                         return "none";
  return null;
}

// Parse a scope spec from the bulk-vendor-import UI. Examples:
//   "national"
//   "district:Edmond"
//   "district:Edmond,Norman"
//   "store:1242, 1245, 1601"
//   "district:Edmond | store:1601 | area:OKC Metro"
//
// Returns { scopes: [{scope_type, scope_id?}], errors: [string] }.
// scope_id is null for 'national'; for everything else it's a UUID
// resolved against the provided name->id maps. Unresolved names go
// into errors.
function parseScopeString(raw, maps) {
  const out = { scopes: [], errors: [] };
  const trimmed = String(raw || "").trim();
  if (!trimmed) return out; // empty → no scope rows (legacy fallback)

  for (const segment of trimmed.split("|")) {
    const s = segment.trim();
    if (!s) continue;
    if (s.toLowerCase() === "national") {
      out.scopes.push({ scope_type: "national", scope_id: null });
      continue;
    }
    const colon = s.indexOf(":");
    if (colon < 0) {
      out.errors.push(`unrecognized scope "${s}" (expected "type:name")`);
      continue;
    }
    const type = s.slice(0, colon).trim().toLowerCase();
    const namesRaw = s.slice(colon + 1).trim();
    if (!["region", "area", "district", "store"].includes(type)) {
      out.errors.push(`unknown scope_type "${type}"`);
      continue;
    }
    const names = namesRaw.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) {
      out.errors.push(`no names listed for ${type}`);
      continue;
    }
    for (const name of names) {
      let id = null;
      const lc = name.toLowerCase();
      if (type === "store") {
        id = maps.storesByNumber.get(name) || null;
      } else if (type === "district") {
        // Code preferred (stable across renames), name as fallback.
        id = maps.districtsByCode.get(lc) || maps.districtsByName.get(lc) || null;
      } else if (type === "area") {
        id = maps.areasByCode.get(lc) || maps.areasByName.get(lc) || null;
      } else if (type === "region") {
        id = maps.regionsByCode.get(lc) || maps.regionsByName.get(lc) || null;
      }
      if (!id) {
        out.errors.push(`${type} "${name}" not found`);
        continue;
      }
      out.scopes.push({ scope_type: type, scope_id: id });
    }
  }
  return out;
}

// Resolve the set of scope keys (one per hierarchy level) that
// match a given store. Returns a Set of string keys like
// "national", "region:<uuid>", "district:<uuid>" etc., or null if
// the store can't be found.
//
// A vendor is visible at the store iff at least one of its
// vendor_scopes rows produces a key in this set (or it has no scope
// rows at all — legacy fallback).
async function visibleScopeKeysForStore(supabase, storeNumber) {
  const num = String(storeNumber).trim();
  if (!num) return null;
  // store_number is text in some installs and the eq() coercion is
  // forgiving enough here. If it returns null, caller treats as
  // "no scoping" and shows all.
  const { data: store } = await supabase
    .from("stores")
    .select("id, district_id, districts(area_id, areas(region_id))")
    .eq("number", num)
    .maybeSingle();
  if (!store) return null;
  const districtId = store.district_id || null;
  const areaId = store.districts?.area_id || null;
  const regionId = store.districts?.areas?.region_id || null;
  const keys = new Set();
  keys.add("national");
  if (store.id)    keys.add(`store:${store.id}`);
  if (districtId)  keys.add(`district:${districtId}`);
  if (areaId)      keys.add(`area:${areaId}`);
  if (regionId)    keys.add(`region:${regionId}`);
  return keys;
}

// True if any of the vendor's scope rows matches a key in
// allowedSet. Zero rows behavior depends on the
// wo2_strict_vendor_scopes feature flag: strict=true → invisible,
// strict=false (default) → visible (legacy fallback).
function isVendorVisibleAtStore(scopes, allowedSet, strict = false) {
  if (!scopes || scopes.length === 0) return !strict;
  for (const s of scopes) {
    if (s.scope_type === "national") {
      if (allowedSet.has("national")) return true;
      continue;
    }
    if (s.scope_id && allowedSet.has(`${s.scope_type}:${s.scope_id}`)) {
      return true;
    }
  }
  return false;
}

// Read the strict-scope feature flag. Cached per-invocation since
// the function is called several times per request via the various
// vendor list paths. Default false on any read failure so we fail
// open (vendors stay visible).
async function isStrictVendorScopes(supabase) {
  try {
    const { data } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "wo2_strict_vendor_scopes")
      .maybeSingle();
    return !!data?.enabled;
  } catch {
    return false;
  }
}

// Returns a Map<ticket_id, unread_count> for the caller, scoped to
// the provided ticket ids. "Unread" = a ticket_messages row whose
// author is not the caller AND whose created_at is after the
// caller's ticket_views.last_seen_at (or no view row exists yet).
//
// Called by getTickets to decorate the list response. Tolerates
// transient errors — caller swallows the throw and renders the
// list without unread counts rather than failing the whole call.
async function computeUnreadByTicket(supabase, userId, ticketIds) {
  const empty = new Map();
  if (!userId || !Array.isArray(ticketIds) || ticketIds.length === 0) return empty;

  const [{ data: msgs }, { data: views }] = await Promise.all([
    supabase
      .from("ticket_messages")
      .select("ticket_id, user_id, created_at")
      .in("ticket_id", ticketIds),
    supabase
      .from("ticket_views")
      .select("ticket_id, last_seen_at")
      .eq("user_id", userId)
      .in("ticket_id", ticketIds),
  ]);

  const seenById = new Map();
  for (const v of views || []) seenById.set(v.ticket_id, v.last_seen_at);

  const counts = new Map();
  for (const m of msgs || []) {
    if (m.user_id === userId) continue; // ignore my own messages
    const seen = seenById.get(m.ticket_id);
    if (!seen || new Date(m.created_at).getTime() > new Date(seen).getTime()) {
      counts.set(m.ticket_id, (counts.get(m.ticket_id) || 0) + 1);
    }
  }
  return counts;
}

// Bulk scope update routine — extracted so both bulkSetVendorScopes
// (scope-only) and bulkEditVendors (scope + active + warranty) can
// reuse the same logic. Body shape:
//   { vendor_ids: [], scopes: [...], mode: 'replace' | 'add' }
async function runBulkScopeUpdate(supabase, userId, body) {
  const vendorIds = Array.isArray(body.vendor_ids) ? body.vendor_ids : [];
  const scopes    = Array.isArray(body.scopes)     ? body.scopes     : [];
  if (vendorIds.length === 0) {
    return respond(400, { ok: false, message: "vendor_ids[] required" });
  }
  if (vendorIds.length > 500) {
    return respond(400, { ok: false, message: "max 500 vendors per bulk request" });
  }
  const isReplace = body.mode !== "add"; // default: replace
  // Validate scope entries once up front.
  for (const s of scopes) {
    if (!["national", "region", "area", "district", "store"].includes(s.scope_type)) {
      return respond(400, { ok: false, message: `bad scope_type: ${s.scope_type}` });
    }
    if (s.scope_type === "national" && s.scope_id) {
      return respond(400, { ok: false, message: "national scope cannot have scope_id" });
    }
    if (s.scope_type !== "national" && !s.scope_id) {
      return respond(400, { ok: false, message: `${s.scope_type} scope requires scope_id` });
    }
  }
  const results = [];
  for (const vid of vendorIds) {
    try {
      if (isReplace) {
        const { error: delErr } = await supabase
          .from("vendor_scopes")
          .delete()
          .eq("vendor_id", vid);
        if (delErr) throw delErr;
      }
      if (scopes.length > 0) {
        const rows = scopes.map((s) => ({
          vendor_id:     vid,
          scope_type:    s.scope_type,
          scope_id:      s.scope_type === "national" ? null : s.scope_id,
          created_by_id: userId,
        }));
        // In add mode, conflict on the partial unique indexes means
        // "already has this scope" — swallow the dupe.
        const { error: insErr } = await supabase
          .from("vendor_scopes")
          .insert(rows);
        if (insErr && !(insErr.code === "23505" && !isReplace)) {
          throw insErr;
        }
      }
      results.push({ vendor_id: vid, status: "updated", scopes: scopes.length });
    } catch (e) {
      results.push({
        vendor_id: vid,
        status: "failed",
        message: e?.message || "update failed",
      });
    }
  }
  const summary = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
    {},
  );
  return respond(200, { ok: true, results, summary, mode: isReplace ? "replace" : "add" });
}

// Maps the caller's role to the approval tier label(s) they can act
// on. Strings here mirror the literal values stored in
// ticket_approvals.approval_tier (set by submitApproval and the
// vendor-portal submitQuote flow).
function approvalTiersForRole(role) {
  switch (String(role || "").toLowerCase()) {
    case "do":    return ["DO < $500"];
    case "sdo":   return ["SDO $501-$1000"];
    case "rvp":
    case "vp":
    case "coo":   return ["RVP $1001-$1750"];
    case "admin": return ["DO < $500", "SDO $501-$1000", "RVP $1001-$1750"];
    default:      return [];
  }
}

// Empty bucket scaffold so the dashboard widget always renders the
// same four sections even when a caller has zero stores in scope.
function emptyAlertGroups() {
  return [
    { key: "new24h",               label: "New (last 24h)",                tone: "info",    count: 0, items: [] },
    { key: "awaitingApproval",     label: "Awaiting your approval",        tone: "warning", count: 0, items: [] },
    { key: "emergencies",          label: "Emergency / Business Critical open", tone: "danger", count: 0, items: [] },
    { key: "awaitingConfirmation", label: "Awaiting your confirmation",    tone: "info",    count: 0, items: [] },
    { key: "stuck",                label: "No activity in 3+ days",        tone: "neutral", count: 0, items: [] },
  ];
}

async function getStoresForUser(supabase, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (["admin", "coo", "vp", "sdo", "rvp"].includes(role)) {
    return { all: true, stores: [] };
  }
  const { data: scopes } = await supabase
    .from("user_scopes")
    .select("scope_type, scope_id")
    .eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, stores: [] };

  const directStoreIds = scopes
    .filter((s) => s.scope_type === "store")
    .map((s) => s.scope_id);
  const districtIds = scopes
    .filter((s) => s.scope_type === "district")
    .map((s) => s.scope_id);
  const areaIds = scopes
    .filter((s) => s.scope_type === "area")
    .map((s) => s.scope_id);
  const regionIds = scopes
    .filter((s) => s.scope_type === "region")
    .map((s) => s.scope_id);

  if (regionIds.length) {
    const { data } = await supabase
      .from("areas")
      .select("id")
      .in("region_id", regionIds);
    for (const a of data || []) areaIds.push(a.id);
  }
  if (areaIds.length) {
    const { data } = await supabase
      .from("districts")
      .select("id")
      .in("area_id", areaIds);
    for (const d of data || []) districtIds.push(d.id);
  }
  const storeIds = new Set(directStoreIds);
  if (districtIds.length) {
    const { data } = await supabase
      .from("stores")
      .select("id")
      .in("district_id", districtIds);
    for (const s of data || []) storeIds.add(s.id);
  }
  if (storeIds.size === 0) return { all: false, stores: [] };

  const { data: storeRows } = await supabase
    .from("stores")
    .select("number")
    .in("id", Array.from(storeIds));
  return {
    all: false,
    stores: (storeRows || []).map((s) => String(s.number)),
  };
}

async function generateWONumber(supabase, storeNumber) {
  const { data, error } = await supabase.rpc("next_wo_sequence", {
    p_store: String(storeNumber),
  });
  if (error) {
    const { data: seq } = await supabase
      .from("wo_sequences")
      .select("last_sequence")
      .eq("store_number", String(storeNumber))
      .single();
    const next = ((seq && seq.last_sequence) || 0) + 1;
    await supabase
      .from("wo_sequences")
      .upsert({ store_number: String(storeNumber), last_sequence: next });
    return `WO-${storeNumber}-${String(next).padStart(3, "0")}`;
  }
  return `WO-${storeNumber}-${String(data).padStart(3, "0")}`;
}


export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  const profile = await getCallerProfile(event);
  if (!profile) return respond(401, { ok: false, message: "Not authenticated." });

  const action = (event.queryStringParameters || {}).action || "";
  const role = String(profile.role || "").toLowerCase();
  const userId = profile.id;
  const userName = profile.full_name || profile.email;
  const supabase = getSupabase();

  try {
    // ── EMAIL TEMPLATES (admin only for writes) ──
    if (action === "getEmailTemplates") {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("kind");
      if (error) throw error;
      return respond(200, { ok: true, templates: data });
    }
    if (action === "saveEmailTemplate" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const payload = JSON.parse(event.body);
      const { kind, subject, body_html, is_active } = payload;
      if (!kind || !subject || !body_html) {
        return respond(400, {
          ok: false,
          message: "kind, subject, body_html required.",
        });
      }
      const { data, error } = await supabase
        .from("email_templates")
        .upsert({
          kind,
          subject,
          body_html,
          is_active: is_active !== false,
          updated_by: userName,
          updated_at: new Date().toISOString(),
        }, { onConflict: "kind" })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, template: data });
    }
    if (action === "previewEmailTemplate" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const { subject, body_html, vars } = JSON.parse(event.body);
      if (!subject || !body_html) {
        return respond(400, {
          ok: false, message: "subject and body_html required.",
        });
      }
      const sampleVars = vars || buildTicketVars({
        wo_number: "WO-1082-001",
        store_number: "1082",
        store_name: "Test Store",
        asset_type: "Fryer",
        category: "Equipment Type",
        priority: "Urgent",
        status: "Pending Approval",
        issue_description: "Sample issue description for preview.",
        approval_level: "SDO $501-$1000",
        approval_request_notes: "Sample approval notes.",
        approval_status: "Approved",
        approval_approved_by: "Jane Approver",
        submitted_by: "GM Test",
        is_business_critical: false,
      });
      return respond(200, {
        ok: true,
        subject: renderTemplate(subject, sampleVars),
        html: renderTemplate(body_html, sampleVars),
      });
    }

    // ── GET ISSUE LIBRARY ──
    if (action === "getIssueLibrary") {
      const { data, error } = await supabase
        .from("issue_library")
        .select("*")
        .order("category")
        .order("sort_order");
      if (error) throw error;
      return respond(200, { ok: true, items: data });
    }

    // ── GET CALLER STORES ──
    // Drives the Store field on the New Ticket modal.
    //   - GM / shift_manager → "single" mode + their primary store (auto-fill)
    //   - DO+                → "list"   mode + every store in their scope
    // Stores arrive as { id, number, name } so the UI can render either a
    // chip or a dropdown without a second round-trip.
    if (action === "getCallerStores") {
      const isSingle = role === "gm" || role === "shift_manager";

      // Source of truth: user_visible_stores(uid) RPC (migration 0032).
      // Already encodes user_scopes (store/district/area/region/global)
      // AND profile.primary_store_id fallback. Using it here means v2
      // store visibility is identical to v1 + the rest of the app.
      async function visibleStoreRows() {
        const { data: visibleIds } = await supabase.rpc("user_visible_stores", {
          uid: userId,
        });
        const ids = (visibleIds ?? [])
          .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
          .filter(Boolean);
        if (!ids.length) return [];
        const { data: rows } = await supabase
          .from("stores")
          .select("id, number, name")
          .in("id", ids)
          .order("number");
        return (rows || []).map((s) => ({
          id: s.id,
          number: String(s.number),
          name: s.name || "",
        }));
      }

      if (isSingle) {
        const stores = await visibleStoreRows();
        if (stores.length === 0) {
          return respond(200, { ok: true, mode: "single", stores: [] });
        }
        if (stores.length === 1) {
          return respond(200, { ok: true, mode: "single", stores });
        }
        // Multi-site shift_manager / GM — let them pick from a dropdown.
        return respond(200, { ok: true, mode: "list", stores });
      }

      // Non-single roles: admin/coo/vp/sdo/rvp see every active store
      // (existing v2 contract). DO falls through user_visible_stores.
      if (["admin", "coo", "vp", "sdo", "rvp"].includes(role)) {
        const { data: rows, error } = await supabase
          .from("stores")
          .select("id, number, name")
          .order("number");
        if (error) throw error;
        return respond(200, {
          ok: true,
          mode: "list",
          stores: (rows || []).map((s) => ({
            id: s.id,
            number: String(s.number),
            name: s.name || "",
          })),
        });
      }

      return respond(200, {
        ok: true,
        mode: "list",
        stores: await visibleStoreRows(),
      });
    }

    // ── GET TICKETS ──
    if (action === "getTickets") {
      const storeAccess = await getStoresForUser(supabase, profile);
      let query = supabase
        .from("tickets")
        .select(`
          *,
          ticket_photos(id, file_url, file_name, upload_type, created_at),
          ticket_approvals(id, approval_tier, status, requested_at, approved_at, approved_by, notes, quote_url),
          ticket_activities(id, user_name, event_type, event_data, notes, created_at)
        `)
        .order("date_submitted", { ascending: false });

      if (!storeAccess.all && storeAccess.stores.length) {
        query = query.in("store_number", storeAccess.stores);
      } else if (!storeAccess.all) {
        return respond(200, { ok: true, tickets: [] });
      }

      const storeFilter = (event.queryStringParameters || {}).store;
      if (storeFilter) query = query.eq("store_number", storeFilter);

      const { data, error } = await query;
      if (error) throw error;

      // Decorate each ticket with unread_message_count from
      // ticket_views. A "message" is unread when:
      //   * its author isn't the caller, AND
      //   * either no view row exists for (caller, ticket) yet,
      //     OR message.created_at > ticket_views.last_seen_at.
      // We pull just the messages + view rows for the returned
      // ticket ids and aggregate in JS — cheaper than a per-row
      // subquery and avoids RLS gymnastics.
      try {
        const ids = (data || []).map((t) => t.id);
        const unreadById = await computeUnreadByTicket(supabase, userId, ids);
        for (const t of data || []) {
          t.unread_message_count = unreadById.get(t.id) || 0;
        }
      } catch (e) {
        console.warn("[facilities-v2] unread-count decoration failed", e);
      }
      return respond(200, { ok: true, tickets: data });
    }

    // ── MARK TICKET SEEN ──
    // Upserts ticket_views.last_seen_at = now() for (caller,
    // ticket). Called when the user expands a card or posts a
    // message — anything that means "I've looked at this."
    if (action === "markTicketSeen" && event.httpMethod === "POST") {
      const { ticketId } = JSON.parse(event.body || "{}");
      if (!ticketId) {
        return respond(400, { ok: false, message: "ticketId required" });
      }
      const { error } = await supabase
        .from("ticket_views")
        .upsert({
          user_id:      userId,
          ticket_id:    ticketId,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "user_id,ticket_id" });
      if (error) throw error;
      return respond(200, { ok: true });
    }

    // ── GET SINGLE TICKET ──
    if (action === "getTicket") {
      const { id } = event.queryStringParameters || {};
      if (!id) return respond(400, { ok: false, message: "id required." });
      const { data, error } = await supabase
        .from("tickets")
        .select(`
          *,
          ticket_photos(*),
          ticket_approvals(*),
          ticket_activities(*)
        `)
        .eq("id", id)
        .single();
      if (error) throw error;
      return respond(200, { ok: true, ticket: data });
    }

    // ── CREATE TICKET ──
    if (action === "createTicket" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body);
      const {
        storeNumber, storeName, storeEmail, doEmail, sdoEmail,
        category, assetType, modelNumber, issueDescription,
        priority, isBusinessCritical, troubleshootingChecked,
        vendorContacted, vendorName, costEstimate, photos,
      } = payload;

      if (!storeNumber || !issueDescription) {
        return respond(400, {
          ok: false,
          message: "Store number and issue description required.",
        });
      }

      const woNumber = await generateWONumber(supabase, storeNumber);

      const { data: ticket, error: ticketError } = await supabase
        .from("tickets")
        .insert({
          wo_number:              woNumber,
          store_number:           storeNumber,
          store_name:             storeName || "",
          store_email:            storeEmail || "",
          do_email:               doEmail || "",
          sdo_email:              sdoEmail || "",
          submitted_by:           userName,
          submitted_by_user_id:   userId,
          category:               category || "",
          asset_type:             assetType || "",
          model_number:           modelNumber || "",
          issue_description:      issueDescription,
          status:                 "submitted",
          priority:               priority || "Standard",
          is_business_critical:   isBusinessCritical || false,
          troubleshooting_checked:troubleshootingChecked || false,
          vendor_contacted:       vendorContacted || false,
          vendor_name:            vendorName || "",
          cost_estimate:          costEstimate || null,
          date_submitted:         new Date().toISOString(),
        })
        .select()
        .single();
      if (ticketError) throw ticketError;

      await supabase.from("ticket_activities").insert({
        ticket_id:   ticket.id,
        user_id:     userId,
        user_name:   userName,
        user_role:   role,
        update_type: "created",
        new_value:   "submitted",
        notes:       "Ticket created",
        event_type:  "ticket_created",
        event_data:  { initial_status: "submitted", wo_number: woNumber },
        visibility:  "all",
      });

      if (photos && photos.length) {
        const photoRows = photos.map((p) => ({
          ticket_id:   ticket.id,
          file_url:    p.url || "",
          file_name:   p.name || "",
          file_size:   p.size || 0,
          mime_type:   p.mimeType || "",
          uploaded_by: userName,
          upload_type: "submission",
        }));
        await supabase.from("ticket_photos").insert(photoRows);
      }

      try {
        await notifyTicketEvent(supabase, ticket, "submitted");
      } catch (e) {
        console.warn("[facilities-v2] notifyTicketEvent submitted failed", e);
      }

      return respond(200, { ok: true, ticket, woNumber });
    }

    // ── UPDATE TICKET ──
    if (action === "updateTicket" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body);
      const {
        id, status, notes, vendorName, vendorId, vendorEta,
        costEstimate, priority, isBusinessCritical,
      } = payload;
      if (!id) return respond(400, { ok: false, message: "id required." });

      const { data: current } = await supabase
        .from("tickets")
        .select("status, pause_state, vendor_name, closed_at")
        .eq("id", id)
        .single();
      if (!current) {
        return respond(404, { ok: false, message: "Ticket not found." });
      }

      const updates = { updated_at: new Date().toISOString() };
      const activityEntries = [];

      // ── Status change — route through state machine ──
      // Legacy clients send v1 strings ("Closed", "In Progress"); new
      // clients send the v2 enum ("closed", "in_progress"). toNewStatus
      // normalizes both.
      if (status !== undefined && status !== null && status !== "") {
        const mapped = toNewStatus(status);
        if (!mapped || !mapped.status) {
          return respond(422, {
            ok: false,
            error: "unknown_status",
            message: `Unrecognized status value: ${status}`,
          });
        }
        const targetStatus = mapped.status;
        const targetPause  = mapped.pause_state;

        if (targetStatus !== current.status) {
          // Real transition. Legacy callers may not send the structured
          // reason/vendor fields the state machine wants. For backwards
          // compatibility during the dual-write release, derive defaults
          // for known-safe cases; otherwise reject with 422 and let the
          // caller learn the new shape.
          const transitionPayload = { ...payload };
          if (targetStatus === "closed" && !transitionPayload.store_close_reason
              && !transitionPayload.admin_close_reason) {
            // Legacy "Closed" with no reason → assume admin close, verified.
            transitionPayload.admin_close_reason = "completed_and_verified";
            transitionPayload.resolution_category =
              transitionPayload.resolution_category || "completed_and_verified";
          }
          if (targetStatus === "scheduled" && !transitionPayload.vendor_id && vendorId) {
            transitionPayload.vendor_id = vendorId;
          }

          let machineResult;
          try {
            machineResult = transition({
              from: current.status,
              to:   targetStatus,
              payload: transitionPayload,
              ctx: {
                ticketId:    id,
                closed_at:   current.closed_at,
                pause_state: current.pause_state,
                actor: { id: userId, role, tier: tierFor(role) },
              },
            });
          } catch (smErr) {
            const code = smErr.statusCode || 500;
            return respond(code, {
              ok: false,
              error: smErr.code || "state_machine_error",
              message: smErr.message,
              ...(smErr.from ? { from: smErr.from, to: smErr.to } : {}),
              ...(smErr.field ? { field: smErr.field } : {}),
            });
          }

          Object.assign(updates, machineResult.updates);
          updates.date_status_updated = new Date().toISOString();
          if (targetStatus === "closed" || targetStatus === "cancelled") {
            // Preserve legacy `date_completed` for v1 reporting tools.
            updates.date_completed = updates.closed_at || new Date().toISOString();
          }

          if (machineResult.activity) {
            activityEntries.push({
              ticket_id: id, user_id: userId, user_name: userName, user_role: role,
              update_type: "status_change",
              old_value:   current.status,
              new_value:   targetStatus,
              event_type:  machineResult.activity.event_type,
              event_data:  machineResult.activity.event_data,
              visibility:  machineResult.activity.visibility,
            });
          }
          if (machineResult.pauseResetActivity) {
            activityEntries.push({
              ticket_id: id, user_id: userId, user_name: userName, user_role: role,
              update_type: "pause_state_change",
              event_type:  machineResult.pauseResetActivity.event_type,
              event_data:  machineResult.pauseResetActivity.event_data,
              visibility:  machineResult.pauseResetActivity.visibility,
            });
          }
        }

        // Legacy substatus (On Hold / Part on Order / New Equipment
        // Ordered) implies a pause_state too. Apply it after status if
        // status didn't auto-reset it.
        if (targetPause && targetPause !== "none"
            && (targetStatus === "in_progress" || targetStatus === "scheduled")) {
          if (current.pause_state !== targetPause) {
            updates.pause_state = targetPause;
            activityEntries.push({
              ticket_id: id, user_id: userId, user_name: userName, user_role: role,
              update_type: "pause_state_change",
              event_type:  "pause_state_changed",
              event_data:  { from: current.pause_state, to: targetPause,
                             auto_reset: false, source: "legacy_status_mapping" },
              visibility:  "all",
            });
          }
        }
      }

      // ── Non-status field edits ──
      if (notes !== undefined) {
        updates.latest_comment = notes;
        if (notes && String(notes).trim()) {
          activityEntries.push({
            ticket_id: id, user_id: userId, user_name: userName, user_role: role,
            update_type: "comment",
            notes,
            event_type:  "comment_added",
            event_data:  { text: notes },
            visibility:  "all",
          });
        }
      }
      if (vendorName !== undefined) updates.vendor_name = vendorName;
      // null clears the link (free-text vendor entry); undefined
      // leaves it alone; any other value sets it. Lets the typeahead
      // drop a stale vendor_id when the user types over the name.
      if (vendorId !== undefined) updates.vendor_id = vendorId || null;
      if (vendorEta) updates.vendor_eta = vendorEta;
      if (costEstimate !== undefined) updates.cost_estimate = costEstimate;
      if (priority) updates.priority = priority;
      if (isBusinessCritical !== undefined) {
        updates.is_business_critical = isBusinessCritical;
      }
      if (vendorName && vendorName !== current.vendor_name) {
        activityEntries.push({
          ticket_id: id, user_id: userId, user_name: userName, user_role: role,
          update_type: "vendor_assigned",
          new_value:   vendorName,
          event_type:  "assigned",
          event_data:  { vendor_name: vendorName, vendor_id: vendorId || null },
          visibility:  "all",
        });
      }
      if (vendorEta) {
        activityEntries.push({
          ticket_id: id, user_id: userId, user_name: userName, user_role: role,
          update_type: "eta_set",
          new_value:   String(vendorEta),
          event_type:  "eta_set",
          event_data:  { eta: vendorEta },
          visibility:  "all",
        });
      }

      const { data: ticket, error } = await supabase
        .from("tickets")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      if (activityEntries.length) {
        await supabase.from("ticket_activities").insert(activityEntries);
      }
      return respond(200, { ok: true, ticket });
    }

    // ── TRANSITION TICKET (new strict path) ──
    // Single endpoint for any status change. Same state machine,
    // strict payload validation. New UI uses this directly; the
    // legacy updateTicket also routes status changes through the
    // same machine for backwards compat.
    // ── DELETE TICKET (admin only) ──
    // Hard delete for cleaning up test tickets. Children cascade
    // (ticket_activities, ticket_photos, ticket_messages,
    // ticket_approvals, ticket_notifications all FK with ON DELETE
    // CASCADE). PM schedules' last_ticket_id and tickets.callback_of
    // / related_to FKs are ON DELETE SET NULL, so PM rotations and
    // related-ticket links survive cleanly. Audit log entry recorded
    // before the delete so we have a paper trail.
    if (action === "deleteTicket" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const body = JSON.parse(event.body || "{}");
      const id = body.id;
      if (!id) return respond(400, { ok: false, message: "id required." });

      const { data: ticket, error: fetchErr } = await supabase
        .from("tickets")
        .select("id, wo_number, store_number, status, submitted_by")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!ticket) return respond(404, { ok: false, message: "Ticket not found." });

      console.log(
        `[facilities-v2] admin ${userName} (${userId}) deleting ticket ` +
        `${ticket.wo_number} (${ticket.id}) store=${ticket.store_number} ` +
        `status=${ticket.status} submitter=${ticket.submitted_by}`,
      );

      const { error: delErr } = await supabase
        .from("tickets")
        .delete()
        .eq("id", id);
      if (delErr) throw delErr;

      return respond(200, {
        ok: true,
        deleted: {
          id: ticket.id,
          wo_number: ticket.wo_number,
          store_number: ticket.store_number,
        },
      });
    }

    if (action === "transitionTicket" && event.httpMethod === "POST") {
      const denied = requireCap(profile, "transition_status");
      if (denied) return denied;

      const body = JSON.parse(event.body || "{}");
      const { id, to, payload: txPayload = {} } = body;
      if (!id || !to) {
        return respond(400, { ok: false, message: "id and to required." });
      }

      const { data: current } = await supabase
        .from("tickets")
        .select("status, pause_state, closed_at, vendor_name, submitted_by_user_id")
        .eq("id", id)
        .single();
      if (!current) return respond(404, { ok: false, message: "Ticket not found." });

      // Submitter-cancel guard. The state machine itself accepts
      // cancelled_by_submitter, but only the actual submitter should
      // be able to use that path. Anyone else needs cancelled_by_ops
      // (which still requires the DO+ tier elsewhere in the system).
      if (
        to === "cancelled"
        && txPayload?.admin_close_reason === "cancelled_by_submitter"
        && current.submitted_by_user_id
        && current.submitted_by_user_id !== userId
      ) {
        return respond(403, {
          ok: false,
          error: "not_submitter",
          message: "Only the original submitter can cancel using this path.",
        });
      }

      let result;
      try {
        result = transition({
          from: current.status,
          to,
          payload: txPayload,
          ctx: {
            ticketId:    id,
            closed_at:   current.closed_at,
            pause_state: current.pause_state,
            actor: { id: userId, role, tier: tierFor(role) },
          },
        });
      } catch (smErr) {
        const code = smErr.statusCode || 500;
        return respond(code, {
          ok: false,
          error: smErr.code || "state_machine_error",
          message: smErr.message,
          ...(smErr.from ? { from: smErr.from, to: smErr.to } : {}),
          ...(smErr.field ? { field: smErr.field } : {}),
        });
      }

      const updates = {
        ...result.updates,
        date_status_updated: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (to === "closed" || to === "cancelled") {
        updates.date_completed = updates.closed_at || new Date().toISOString();
      }

      const { data: ticket, error } = await supabase
        .from("tickets")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      const activityRows = [];
      if (result.activity) {
        activityRows.push({
          ticket_id: id, user_id: userId, user_name: userName, user_role: role,
          update_type: "status_change",
          old_value:   current.status,
          new_value:   to,
          event_type:  result.activity.event_type,
          event_data:  result.activity.event_data,
          visibility:  result.activity.visibility,
        });
      }
      if (result.pauseResetActivity) {
        activityRows.push({
          ticket_id: id, user_id: userId, user_name: userName, user_role: role,
          update_type: "pause_state_change",
          event_type:  result.pauseResetActivity.event_type,
          event_data:  result.pauseResetActivity.event_data,
          visibility:  result.pauseResetActivity.visibility,
        });
      }
      if (activityRows.length) {
        await supabase.from("ticket_activities").insert(activityRows);
      }

      // PM bookkeeping: if this ticket was spawned from a PM schedule
      // and just hit a success-close, advance the schedule's
      // next_due_at and clear last_ticket_id so the next cycle can
      // spawn. No-op for non-PM tickets or cancellations.
      try {
        await onPMTicketClosed(supabase, ticket);
      } catch (e) {
        console.warn("[facilities-v2] onPMTicketClosed failed:", e?.message);
      }

      return respond(200, { ok: true, ticket });
    }

    // ── SET PAUSE STATE ──
    if (action === "setPauseState" && event.httpMethod === "POST") {
      const denied = requireCap(profile, "set_pause_state");
      if (denied) return denied;

      const body = JSON.parse(event.body || "{}");
      const { id, pause_state: nextPause, reason_note: reasonNote } = body;
      if (!id || nextPause === undefined) {
        return respond(400, { ok: false, message: "id and pause_state required." });
      }
      const { data: current } = await supabase
        .from("tickets")
        .select("status, pause_state")
        .eq("id", id)
        .single();
      if (!current) return respond(404, { ok: false, message: "Ticket not found." });

      let result;
      try {
        result = setPause({
          currentStatus: current.status,
          currentPause:  current.pause_state,
          to:            nextPause,
          reasonNote,
        });
      } catch (smErr) {
        return respond(smErr.statusCode || 500, {
          ok: false,
          error: smErr.code || "state_machine_error",
          message: smErr.message,
        });
      }

      const { data: ticket, error } = await supabase
        .from("tickets")
        .update({ ...result.updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      await supabase.from("ticket_activities").insert({
        ticket_id: id, user_id: userId, user_name: userName, user_role: role,
        update_type: "pause_state_change",
        event_type:  result.activity.event_type,
        event_data:  result.activity.event_data,
        visibility:  result.activity.visibility,
      });

      return respond(200, { ok: true, ticket });
    }

    // ── GET TICKET ACTIVITIES ──
    if (action === "getTicketActivities") {
      const { id } = event.queryStringParameters || {};
      if (!id) return respond(400, { ok: false, message: "id required." });

      let q = supabase
        .from("ticket_activities")
        .select("id, ticket_id, user_id, user_name, user_role, event_type, event_data, notes, visibility, created_at")
        .eq("ticket_id", id)
        .order("created_at", { ascending: false });

      const allowed = activityVisibilityForTier(tierFor(role));
      if (allowed) q = q.in("visibility", allowed);

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, activities: data || [] });
    }

    // ── SUBMIT APPROVAL ──
    if (action === "submitApproval" && event.httpMethod === "POST") {
      const { id, approvalTier, approvalNotes, quoteUrl } = JSON.parse(event.body);
      if (!id || !approvalTier) {
        return respond(400, { ok: false, message: "id and approvalTier required." });
      }
      const { error: approvalError } = await supabase
        .from("ticket_approvals")
        .insert({
          ticket_id:    id,
          approval_tier:approvalTier,
          requested_by: userName,
          notes:        approvalNotes || "",
          quote_url:    quoteUrl || "",
          status:       "Pending",
        });
      if (approvalError) throw approvalError;

      await supabase
        .from("tickets")
        .update({
          approval_level:         approvalTier,
          approval_request_notes: approvalNotes || "",
          approval_status:        "Pending",
          updated_at:             new Date().toISOString(),
        })
        .eq("id", id);

      await supabase.from("ticket_activities").insert({
        ticket_id:   id, user_id: userId, user_name: userName,
        user_role:   role, update_type: "approval", new_value: "Pending",
        notes:       `Approval requested: ${approvalTier}`,
        event_type:  "approval_requested",
        event_data:  { approval_tier: approvalTier, quote_url: quoteUrl || null,
                       notes: approvalNotes || null },
        visibility:  "all",
      });

      const { data: refreshed } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", id)
        .single();
      if (refreshed) {
        try {
          await notifyTicketEvent(supabase, refreshed, "approval_requested");
        } catch (e) {
          console.warn("[facilities-v2] notifyTicketEvent approval_requested failed", e);
        }
      }

      return respond(200, { ok: true });
    }

    // ── DECIDE APPROVAL ──
    if (action === "decideApproval" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const { id, approvalId, decision, notes } = JSON.parse(event.body);
      await supabase
        .from("ticket_approvals")
        .update({
          status:      decision,
          approved_by: userName,
          approved_at: new Date().toISOString(),
          notes:       notes || "",
        })
        .eq("id", approvalId);

      await supabase
        .from("tickets")
        .update({
          approval_status:     decision,
          approval_approved_by:userName,
          approval_approved_at:new Date().toISOString(),
          updated_at:          new Date().toISOString(),
        })
        .eq("id", id);

      await supabase.from("ticket_activities").insert({
        ticket_id:   id, user_id: userId, user_name: userName,
        user_role:   role, update_type: "approval", new_value: decision,
        notes:       `Approval ${decision} by ${userName}`,
        event_type:  "approval_decided",
        event_data:  { decision, decided_by: userName, decision_notes: notes || null },
        visibility:  "all",
      });

      const { data: refreshed } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", id)
        .single();
      if (refreshed) {
        try {
          await notifyTicketEvent(supabase, refreshed, "approval_decided");
        } catch (e) {
          console.warn("[facilities-v2] notifyTicketEvent approval_decided failed", e);
        }
      }

      return respond(200, { ok: true });
    }

    // ── UPLOAD PHOTO ──
    if (action === "uploadPhoto" && event.httpMethod === "POST") {
      const { id, photoData, photoType, photoName, uploadType } = JSON.parse(event.body);
      if (!id || !photoData) {
        return respond(400, { ok: false, message: "id and photoData required." });
      }
      const buf = Buffer.from(photoData, "base64");
      const ext = (photoName || "photo.jpg").split(".").pop();
      const fileName = `${id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(fileName, buf, {
          contentType: photoType || "image/jpeg",
          upsert: false,
        });
      if (uploadError) {
        console.error("Upload error:", JSON.stringify(uploadError));
        throw uploadError;
      }
      const { data: { publicUrl } } = supabase.storage
        .from(PHOTOS_BUCKET)
        .getPublicUrl(fileName);

      const { data: photo } = await supabase
        .from("ticket_photos")
        .insert({
          ticket_id:   id,
          file_url:    publicUrl || fileName,
          file_name:   photoName || "photo.jpg",
          file_size:   buf.length,
          mime_type:   photoType || "image/jpeg",
          uploaded_by: userName,
          upload_type: uploadType || "update",
        })
        .select()
        .single();

      // Activity entry so the photo shows up on the ticket timeline.
      await supabase.from("ticket_activities").insert({
        ticket_id: id, user_id: userId, user_name: userName, user_role: role,
        update_type: "photo_added",
        event_type:  "photo_added",
        event_data: {
          photo_id:    photo?.id,
          file_name:   photoName || "photo.jpg",
          upload_type: uploadType || "update",
        },
        visibility: "all",
      });

      return respond(200, { ok: true, photo });
    }

    // ── BULK IMPORT VENDORS ──
    // Admin-only. Accepts an array of vendor rows + optional scope
    // strings. Upserts by name (matches the existing
    // vendors_name_unique constraint). Each scope string is parsed
    // into one or more vendor_scopes inserts; resolution failures
    // are surfaced per-row so the admin can fix the input.
    //
    // Body shape:
    //   { rows: [{
    //       name, category, services, service_area,
    //       contact_person, email, phone, notes, website,
    //       is_active (optional bool),
    //       scope          // e.g. "district:Edmond | store:1242,1245" or "national"
    //     }, ...],
    //     replace_scopes: bool   // when true, existing scopes are wiped
    //                            // before new ones are inserted (default true)
    //   }
    if (action === "bulkImportVendors" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const body = JSON.parse(event.body || "{}");
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const replaceScopes = body.replace_scopes !== false; // default true
      if (rows.length === 0) {
        return respond(400, { ok: false, message: "rows[] required" });
      }
      if (rows.length > 1000) {
        return respond(400, { ok: false, message: "max 1000 rows per import" });
      }

      // Build name AND code maps for district/area/region/store so
      // we can resolve scope strings ("district:Edmond" or
      // "district:D-OKC-01") to UUIDs. Codes are preferred when
      // they exist because they're stable across renames; names
      // remain a convenience for hand-written imports. Done up
      // front so each row's resolver is in-memory only.
      const [districtsR, areasR, regionsR, storesR] = await Promise.all([
        supabase.from("districts").select("id, name, code"),
        supabase.from("areas").select("id, name, code"),
        supabase.from("regions").select("id, name, code"),
        supabase.from("stores").select("id, number"),
      ]);
      const districtsByName = new Map(
        (districtsR.data || []).map((d) => [String(d.name).toLowerCase().trim(), d.id]),
      );
      const districtsByCode = new Map(
        (districtsR.data || []).filter((d) => d.code).map((d) => [String(d.code).toLowerCase().trim(), d.id]),
      );
      const areasByName = new Map(
        (areasR.data || []).map((a) => [String(a.name).toLowerCase().trim(), a.id]),
      );
      const areasByCode = new Map(
        (areasR.data || []).filter((a) => a.code).map((a) => [String(a.code).toLowerCase().trim(), a.id]),
      );
      const regionsByName = new Map(
        (regionsR.data || []).map((r) => [String(r.name).toLowerCase().trim(), r.id]),
      );
      const regionsByCode = new Map(
        (regionsR.data || []).filter((r) => r.code).map((r) => [String(r.code).toLowerCase().trim(), r.id]),
      );
      const storesByNumber = new Map(
        (storesR.data || []).map((s) => [String(s.number).trim(), s.id]),
      );

      const results = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = String(r.name || "").trim();
        if (!name) {
          results.push({ row: i + 1, name: "", status: "failed", message: "name required" });
          continue;
        }

        // Parse the scope string. Returns { ok, scopes, errors[] }.
        const parsed = parseScopeString(r.scope || "", {
          districtsByName, districtsByCode,
          areasByName,     areasByCode,
          regionsByName,   regionsByCode,
          storesByNumber,
        });
        if (parsed.errors.length > 0) {
          results.push({
            row: i + 1, name,
            status: "failed",
            message: `scope: ${parsed.errors.join("; ")}`,
          });
          continue;
        }

        const isActive = r.is_active === false || r.is_active === "false"
          ? false
          : true;

        try {
          // Upsert by name. We do select-or-insert manually instead
          // of supabase's onConflict because we also need to know
          // whether this is a create or update for the results.
          const { data: existing } = await supabase
            .from("vendors")
            .select("id")
            .eq("name", name)
            .maybeSingle();

          // Coerce warranty fields if present. Strings → ints;
          // anything else (empty, missing) stays null.
          const labWar  = parseIntOrNull(r.labor_warranty_days);
          const partWar = parseIntOrNull(r.parts_warranty_days);
          const partSrc = normalizeWarrantySource(r.parts_warranty_source);

          const fields = {
            name,
            category:               r.category || null,
            services:               r.services || null,
            service_area:           r.service_area || null,
            contact_person:         r.contact_person || null,
            email:                  r.email || null,
            phone:                  r.phone || null,
            notes:                  r.notes || null,
            website:                r.website || null,
            is_active:              isActive,
            labor_warranty_days:    labWar,
            parts_warranty_days:    partWar,
            parts_warranty_source:  partSrc,
            warranty_notes:         r.warranty_notes || null,
          };

          let vendorId;
          let kind;
          if (existing) {
            const { error } = await supabase
              .from("vendors")
              .update(fields)
              .eq("id", existing.id);
            if (error) throw error;
            vendorId = existing.id;
            kind = "updated";
          } else {
            const { data: inserted, error } = await supabase
              .from("vendors")
              .insert(fields)
              .select("id")
              .single();
            if (error) throw error;
            vendorId = inserted.id;
            kind = "created";
          }

          // Scope rows.
          if (replaceScopes) {
            await supabase
              .from("vendor_scopes")
              .delete()
              .eq("vendor_id", vendorId);
          }
          if (parsed.scopes.length > 0) {
            const scopeRows = parsed.scopes.map((s) => ({
              vendor_id:     vendorId,
              scope_type:    s.scope_type,
              scope_id:      s.scope_type === "national" ? null : s.scope_id,
              created_by_id: userId,
            }));
            // Ignore unique-violation if a row already exists when
            // replaceScopes=false (caller wanted append semantics).
            const { error: scopeErr } = await supabase
              .from("vendor_scopes")
              .insert(scopeRows);
            if (scopeErr && !replaceScopes && scopeErr.code !== "23505") {
              throw scopeErr;
            }
          }

          results.push({
            row: i + 1, name,
            status: kind, // "created" | "updated"
            scopes: parsed.scopes.length,
          });
        } catch (e) {
          results.push({
            row: i + 1, name,
            status: "failed",
            message: e?.message || "insert failed",
          });
        }
      }

      const summary = results.reduce(
        (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
        {},
      );
      return respond(200, { ok: true, results, summary });
    }

    // ── SAVE VENDOR ──
    if (action === "saveVendor" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const payload = JSON.parse(event.body);
      const { id: vendorId, ...fields } = payload;
      if (vendorId) {
        const { data, error } = await supabase
          .from("vendors")
          .update(fields)
          .eq("id", vendorId)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, vendor: data });
      } else {
        const { data, error } = await supabase
          .from("vendors")
          .insert(fields)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, vendor: data });
      }
    }

    // ── STATS ──
    if (action === "getStats") {
      const storeAccess = await getStoresForUser(supabase, profile);
      let query = supabase
        .from("tickets")
        .select("status, priority, is_business_critical, date_submitted, store_number");
      if (!storeAccess.all && storeAccess.stores.length) {
        query = query.in("store_number", storeAccess.stores);
      } else if (!storeAccess.all) {
        return respond(200, {
          ok: true,
          stats: { open: 0, closed: 0, critical: 0, aged: 0, byStatus: {}, total: 0 },
        });
      }
      const { data, error } = await query;
      if (error) throw error;

      const now = Date.now();
      // "Open" is anything not in a terminal state. Phase 1 enum:
      // completed counts as still-open-pending-confirmation, closed
      // and cancelled are terminal. Mirrors the frontend's
      // isOpenStatus() helper exactly.
      const TERMINAL = new Set(["completed", "closed", "cancelled"]);
      const open     = data.filter((t) => !TERMINAL.has(t.status)).length;
      const closed   = data.filter((t) => t.status === "closed").length;
      const critical = data.filter(
        (t) => t.is_business_critical && !TERMINAL.has(t.status),
      ).length;
      const aged = data.filter((t) => {
        if (TERMINAL.has(t.status)) return false;
        const d = new Date(t.date_submitted);
        return (now - d.getTime()) / 86400000 >= 15;
      }).length;
      const byStatus = {};
      for (const t of data) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

      return respond(200, {
        ok: true,
        stats: { open, closed, critical, aged, byStatus, total: data.length },
      });
    }

    // ── ISSUE LIBRARY CRUD (admin only) ──
    if (action === "saveIssueItem" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const payload = JSON.parse(event.body);
      const { id: itemId, ...fields } = payload;
      if (itemId) {
        const { data, error } = await supabase
          .from("issue_library")
          .update(fields)
          .eq("id", itemId)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, item: data });
      } else {
        const { data, error } = await supabase
          .from("issue_library")
          .insert(fields)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, item: data });
      }
    }
    if (action === "deleteIssueItem" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const { id: itemId } = JSON.parse(event.body);
      await supabase.from("issue_library").delete().eq("id", itemId);
      return respond(200, { ok: true });
    }

    // ── VENDOR RATINGS ──
    if (action === "rateVendor" && event.httpMethod === "POST") {
      const { vendorId, ticketId, storeNumber, rating, comment } =
        JSON.parse(event.body);
      if (!vendorId || !rating) {
        return respond(400, {
          ok: false,
          message: "vendorId and rating required.",
        });
      }
      if (rating < 1 || rating > 5) {
        return respond(400, { ok: false, message: "Rating must be 1-5." });
      }
      const { data, error } = await supabase
        .from("vendor_ratings")
        .insert({
          vendor_id:    vendorId,
          ticket_id:    ticketId || null,
          store_number: storeNumber || "",
          rating:       parseInt(rating, 10),
          comment:      comment || "",
          rated_by:     userName,
        })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, rating: data });
    }
    if (action === "getVendorRatings") {
      const { vendorId } = event.queryStringParameters || {};
      if (!vendorId) {
        return respond(400, { ok: false, message: "vendorId required." });
      }
      const { data, error } = await supabase
        .from("vendor_ratings")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("rated_at", { ascending: false });
      if (error) throw error;
      const avg = data.length
        ? Math.round((data.reduce((t, r) => t + r.rating, 0) / data.length) * 10) / 10
        : null;
      return respond(200, {
        ok: true, ratings: data, avgRating: avg, totalRatings: data.length,
      });
    }

    // ── VENDOR LIST / SEARCH ──
    if (action === "getVendors") {
      // Optional store-scoped filtering: if storeNumber is passed,
      // restrict to vendors whose vendor_scopes intersect the
      // store's hierarchy (or who have no scopes at all = legacy
      // "visible everywhere" fallback).
      const { storeNumber } = event.queryStringParameters || {};
      const { data: vendors, error } = await supabase
        .from("vendors")
        .select("*, vendor_ratings(rating), vendor_scopes(id, scope_type, scope_id)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;

      let visibleVendors = vendors || [];
      if (storeNumber) {
        const allowedSet = await visibleScopeKeysForStore(supabase, storeNumber);
        if (allowedSet === null) {
          // Store lookup failed; fall back to "show everything" so
          // the caller isn't blocked on a transient error.
          visibleVendors = vendors || [];
        } else {
          const strict = await isStrictVendorScopes(supabase);
          visibleVendors = (vendors || []).filter((v) =>
            isVendorVisibleAtStore(v.vendor_scopes || [], allowedSet, strict),
          );
        }
      }

      const enriched = visibleVendors.map((v) => {
        const ratings = (v.vendor_ratings || []).map((r) => r.rating);
        const avg = ratings.length
          ? Math.round((ratings.reduce((t, r) => t + r, 0) / ratings.length) * 10) / 10
          : null;
        const { vendor_ratings, ...rest } = v;
        return { ...rest, avgRating: avg, totalRatings: ratings.length };
      });
      return respond(200, { ok: true, vendors: enriched });
    }
    // ── VENDOR STORE PREFERENCES ──
    // Per-store ranked preferences by category. Read-anyone (so the
    // vendor picker / dashboard can decorate accordingly); writes
    // require DO+.
    if (action === "getStoreVendorPreferences") {
      const { storeId, storeNumber } = event.queryStringParameters || {};
      let resolvedStoreId = storeId || null;
      if (!resolvedStoreId && storeNumber) {
        const { data: s } = await supabase
          .from("stores")
          .select("id")
          .eq("number", String(storeNumber).trim())
          .maybeSingle();
        resolvedStoreId = s?.id || null;
      }
      if (!resolvedStoreId) {
        return respond(400, { ok: false, message: "storeId or storeNumber required" });
      }
      const { data, error } = await supabase
        .from("vendor_store_preferences")
        .select("id, store_id, category, vendor_id, rank, notes, created_at, vendors(name, category)")
        .eq("store_id", resolvedStoreId)
        .order("category")
        .order("rank");
      if (error) throw error;
      return respond(200, { ok: true, store_id: resolvedStoreId, preferences: data || [] });
    }

    // Per-vendor view of preference rows for the vendor edit modal.
    if (action === "getVendorPreferences") {
      const { vendorId } = event.queryStringParameters || {};
      if (!vendorId) {
        return respond(400, { ok: false, message: "vendorId required" });
      }
      const { data, error } = await supabase
        .from("vendor_store_preferences")
        .select("id, store_id, category, vendor_id, rank, notes, created_at, stores(number, name)")
        .eq("vendor_id", vendorId)
        .order("category")
        .order("rank");
      if (error) throw error;
      return respond(200, { ok: true, preferences: data || [] });
    }

    if (action === "saveStoreVendorPreference" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const body = JSON.parse(event.body || "{}");
      const { id, store_id, vendor_id, category, rank, notes } = body;
      if (!store_id || !vendor_id || !category) {
        return respond(400, {
          ok: false, message: "store_id, vendor_id, category required",
        });
      }
      const fields = {
        store_id,
        vendor_id,
        category: String(category).trim(),
        rank: Number.isFinite(Number(rank)) ? Number(rank) : 1,
        notes: notes || null,
        created_by_id: userId,
      };
      if (id) {
        const { data, error } = await supabase
          .from("vendor_store_preferences")
          .update(fields)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, preference: data });
      }
      const { data, error } = await supabase
        .from("vendor_store_preferences")
        .upsert(fields, { onConflict: "store_id,category,vendor_id" })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, preference: data });
    }

    if (action === "deleteStoreVendorPreference" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const { id } = JSON.parse(event.body || "{}");
      if (!id) return respond(400, { ok: false, message: "id required" });
      const { error } = await supabase
        .from("vendor_store_preferences")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return respond(200, { ok: true });
    }

    // ── IN-WARRANTY MATCHES ──
    // Used by the new-ticket flow to warn a GM that a related
    // completed ticket may still be under warranty — should this be
    // a callback to that vendor rather than a fresh dispatch?
    //
    // Inputs: storeNumber (required), assetType + category (at
    // least one). Returns up to 5 closed/completed tickets at this
    // store where (asset_type ilike assetType OR category ilike
    // category) AND warranty_starts_at is set AND labor- or
    // parts-warranty still has time on it.
    if (action === "getRelatedInWarranty") {
      const { storeNumber, assetType, category } = event.queryStringParameters || {};
      if (!storeNumber) {
        return respond(400, { ok: false, message: "storeNumber required" });
      }
      if (!assetType && !category) {
        return respond(200, { ok: true, tickets: [] });
      }
      // Pull a window of recent warranty-stamped tickets at this
      // store; do the asset-type / category match in JS so we can
      // use ILIKE-ish substring semantics consistent with what the
      // vendor recommendation flow uses elsewhere.
      const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString();
      const { data: rows } = await supabase
        .from("tickets")
        .select(`
          id, wo_number, asset_type, category, vendor_name,
          completed_at, closed_at, store_number,
          warranty_labor_days, warranty_parts_days,
          warranty_parts_source, warranty_starts_at, warranty_notes
        `)
        .eq("store_number", String(storeNumber).trim())
        .in("status", ["closed", "completed"])
        .not("warranty_starts_at", "is", null)
        .gte("warranty_starts_at", yearAgo)
        .order("warranty_starts_at", { ascending: false });

      const at = String(assetType || "").toLowerCase().trim();
      const cat = String(category || "").toLowerCase().trim();
      const now = Date.now();
      const matches = [];
      for (const t of rows || []) {
        const tA = String(t.asset_type || "").toLowerCase();
        const tC = String(t.category || "").toLowerCase();
        const assetMatch = at && (
          tA.includes(at) || at.includes(tA) ||
          tC.includes(at) // also match against category for unit-suffixed types
        );
        const catMatch = cat && (
          tC.includes(cat) || cat.includes(tC)
        );
        if (!assetMatch && !catMatch) continue;
        // Is warranty still active?
        const startMs = new Date(t.warranty_starts_at).getTime();
        if (!Number.isFinite(startMs)) continue;
        const laborOk = (t.warranty_labor_days || 0) > 0 &&
          startMs + t.warranty_labor_days * 86400_000 > now;
        const partsOk = (t.warranty_parts_days || 0) > 0 &&
          startMs + t.warranty_parts_days * 86400_000 > now;
        if (!laborOk && !partsOk) continue;
        matches.push({
          ...t,
          labor_active: laborOk,
          parts_active: partsOk,
          labor_expires_at: t.warranty_labor_days
            ? new Date(startMs + t.warranty_labor_days * 86400_000).toISOString()
            : null,
          parts_expires_at: t.warranty_parts_days
            ? new Date(startMs + t.warranty_parts_days * 86400_000).toISOString()
            : null,
        });
        if (matches.length >= 5) break;
      }
      return respond(200, { ok: true, tickets: matches });
    }

    // ── ORG LOOKUPS (for scope label rendering) ──
    // Tiny endpoint that returns the regions/areas/districts/stores
    // index any vendor-scope-aware UI needs to resolve scope_id ->
    // readable label. Authed; everyone in the BETA can call this
    // (no scope filtering — labels for the whole org are needed to
    // render vendor scope badges).
    if (action === "getOrgIndex") {
      const [r, a, d, s] = await Promise.all([
        supabase.from("regions").select("id, name, code").order("name"),
        supabase.from("areas").select("id, name, code, region_id").order("name"),
        supabase.from("districts").select("id, name, code, area_id").order("name"),
        supabase.from("stores").select("id, number, name").order("number"),
      ]);
      return respond(200, {
        ok: true,
        regions:   r.data || [],
        areas:     a.data || [],
        districts: d.data || [],
        stores:    s.data || [],
      });
    }

    // ── VENDOR SCOPES ──
    // Get scopes for a single vendor (used by the edit modal).
    if (action === "getVendorScopes") {
      const { vendorId } = event.queryStringParameters || {};
      if (!vendorId) {
        return respond(400, { ok: false, message: "vendorId required" });
      }
      const { data: scopes, error } = await supabase
        .from("vendor_scopes")
        .select("id, scope_type, scope_id, created_at")
        .eq("vendor_id", vendorId);
      if (error) throw error;
      return respond(200, { ok: true, scopes: scopes || [] });
    }

    // Replace a vendor's full scope set in one call. Frontend sends
    // the desired list; we diff against current rows and add/remove
    // as needed in a single transaction-ish pass (best-effort
    // without explicit transactions — duplicates are caught by the
    // partial unique indexes).
    if (action === "setVendorScopes" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const { vendorId, scopes } = JSON.parse(event.body);
      if (!vendorId || !Array.isArray(scopes)) {
        return respond(400, { ok: false, message: "vendorId + scopes[] required" });
      }
      // Validate each scope entry.
      for (const s of scopes) {
        if (!["national", "region", "area", "district", "store"].includes(s.scope_type)) {
          return respond(400, { ok: false, message: `bad scope_type: ${s.scope_type}` });
        }
        if (s.scope_type === "national" && s.scope_id) {
          return respond(400, { ok: false, message: "national scope cannot have scope_id" });
        }
        if (s.scope_type !== "national" && !s.scope_id) {
          return respond(400, { ok: false, message: `${s.scope_type} scope requires scope_id` });
        }
      }
      // Wipe + replace. Simpler than diffing and we don't have rows
      // big enough for the rewrite to matter.
      const { error: delErr } = await supabase
        .from("vendor_scopes")
        .delete()
        .eq("vendor_id", vendorId);
      if (delErr) throw delErr;
      if (scopes.length > 0) {
        const rows = scopes.map((s) => ({
          vendor_id:     vendorId,
          scope_type:    s.scope_type,
          scope_id:      s.scope_type === "national" ? null : s.scope_id,
          created_by_id: userId,
        }));
        const { error: insErr } = await supabase
          .from("vendor_scopes")
          .insert(rows);
        if (insErr) throw insErr;
      }
      return respond(200, { ok: true, count: scopes.length });
    }

    // Bulk variant: apply the same scope set to many vendors at once.
    // mode = 'replace' wipes each vendor's existing scopes first
    // (same as the single-vendor flow); mode = 'add' inserts only
    // missing rows so existing scopes are preserved. Returns
    // per-vendor results so the UI can show a breakdown.
    if (action === "bulkSetVendorScopes" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const body = JSON.parse(event.body);
      return await runBulkScopeUpdate(supabase, userId, body);
    }

    // Combined bulk edit. Lets the caller toggle is_active, apply
    // warranty defaults, AND/OR apply scopes in a single call.
    // Each optional section is applied only when included — fields
    // not in the body are left untouched.
    //
    // Body shape:
    //   { vendor_ids: [...],
    //     active?: { is_active: boolean },
    //     warranty?: {
    //       labor_warranty_days?: int | null,
    //       parts_warranty_days?: int | null,
    //       parts_warranty_source?: 'vendor'|'manufacturer'|'none'|null,
    //       warranty_notes?: string | null
    //     },
    //     scope?: { scopes: [...], mode: 'replace' | 'add' }
    //   }
    if (action === "bulkEditVendors" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const body = JSON.parse(event.body || "{}");
      const vendorIds = Array.isArray(body.vendor_ids) ? body.vendor_ids : [];
      if (vendorIds.length === 0) {
        return respond(400, { ok: false, message: "vendor_ids[] required" });
      }
      if (vendorIds.length > 500) {
        return respond(400, { ok: false, message: "max 500 vendors per bulk request" });
      }
      if (!body.active && !body.warranty && !body.scope) {
        return respond(400, { ok: false, message: "nothing to update — include active, warranty, or scope" });
      }

      // Build the vendors update payload for the active + warranty
      // sections. Skipped entirely if neither is present.
      const vendorUpdates = {};
      if (body.active && typeof body.active.is_active === "boolean") {
        vendorUpdates.is_active = body.active.is_active;
      }
      if (body.warranty) {
        const w = body.warranty;
        // Each field is explicitly optional. We use "in" so passing
        // null clears a field, while omitting it preserves the
        // existing value.
        if ("labor_warranty_days" in w) {
          vendorUpdates.labor_warranty_days =
            w.labor_warranty_days == null ? null : Number(w.labor_warranty_days);
        }
        if ("parts_warranty_days" in w) {
          vendorUpdates.parts_warranty_days =
            w.parts_warranty_days == null ? null : Number(w.parts_warranty_days);
        }
        if ("parts_warranty_source" in w) {
          const src = normalizeWarrantySource(w.parts_warranty_source);
          vendorUpdates.parts_warranty_source = src;
        }
        if ("warranty_notes" in w) {
          vendorUpdates.warranty_notes = w.warranty_notes || null;
        }
      }

      const results = [];
      for (const vid of vendorIds) {
        const row = { vendor_id: vid, status: "updated", actions: [] };
        try {
          if (Object.keys(vendorUpdates).length > 0) {
            const { error } = await supabase
              .from("vendors")
              .update(vendorUpdates)
              .eq("id", vid);
            if (error) throw error;
            if ("is_active" in vendorUpdates) row.actions.push(
              vendorUpdates.is_active ? "activated" : "deactivated",
            );
            if ("labor_warranty_days" in vendorUpdates ||
                "parts_warranty_days" in vendorUpdates ||
                "parts_warranty_source" in vendorUpdates ||
                "warranty_notes" in vendorUpdates) {
              row.actions.push("warranty");
            }
          }
          if (body.scope) {
            // Reuse the scope routine.
            const scopeRes = await runBulkScopeUpdate(supabase, userId, {
              vendor_ids: [vid],
              scopes:     body.scope.scopes,
              mode:       body.scope.mode,
            });
            // scopeRes is a response object — peek into its body's
            // results to find this vendor's outcome.
            const inner = JSON.parse(scopeRes.body)?.results?.[0];
            if (inner?.status === "failed") {
              throw new Error(inner.message || "scope update failed");
            }
            row.actions.push("scope");
          }
          if (row.actions.length === 0) {
            row.status = "noop";
          }
        } catch (e) {
          row.status = "failed";
          row.message = e?.message || "update failed";
        }
        results.push(row);
      }
      const summary = results.reduce(
        (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
        {},
      );
      return respond(200, { ok: true, results, summary });
    }

    if (action === "searchVendors") {
      const { q, assetType, category, storeNumber } = event.queryStringParameters || {};
      // Pull scope rows alongside so we can scope-filter post-query.
      // Limit applied AFTER scope filter so we don't return only 8
      // pre-filter candidates and then potentially nothing.
      let query = supabase
        .from("vendors")
        .select("id,name,category,service_area,services,phone,email,contact_person,is_internal,vendor_scopes(scope_type,scope_id)")
        .eq("is_active", true);
      if (q) {
        query = query.or(
          `name.ilike.%${q}%,services.ilike.%${q}%,category.ilike.%${q}%`,
        );
      }
      // Match on asset_type AND/OR the issue's category against both
      // vendor.services and vendor.category. Issues like "HVAC 1"
      // and "HVAC 2" are store-specific equipment names; the vendor
      // catalog uses higher-level categories ("HVAC"). Without
      // matching on category we'd return zero HVAC vendors for any
      // store with numbered units.
      if (assetType || category) {
        const orParts = [];
        const escape = (s) => String(s).replace(/[(),]/g, "");
        if (assetType) {
          const a = escape(assetType);
          orParts.push(`services.ilike.%${a}%`);
          orParts.push(`category.ilike.%${a}%`);
        }
        if (category) {
          const c = escape(category);
          orParts.push(`services.ilike.%${c}%`);
          orParts.push(`category.ilike.%${c}%`);
        }
        if (orParts.length) {
          query = query.or(orParts.join(","));
        }
      }
      query = query.order("name");
      const { data, error } = await query;
      if (error) throw error;
      let visible = data || [];
      if (storeNumber) {
        const allowed = await visibleScopeKeysForStore(supabase, storeNumber);
        if (allowed) {
          const strict = await isStrictVendorScopes(supabase);
          visible = visible.filter((v) =>
            isVendorVisibleAtStore(v.vendor_scopes || [], allowed, strict),
          );
        }
        // Sort preferred vendors to the top. Pull preference rows
        // for this store that match the caller's category (or any
        // category if none was given). Vendors appear by rank asc;
        // non-preferred vendors keep their natural name order.
        if (category || assetType) {
          // Resolve store id from the number to query preferences.
          const { data: storeRow } = await supabase
            .from("stores")
            .select("id")
            .eq("number", String(storeNumber).trim())
            .maybeSingle();
          if (storeRow?.id) {
            let prefsQuery = supabase
              .from("vendor_store_preferences")
              .select("vendor_id, category, rank")
              .eq("store_id", storeRow.id);
            const { data: prefs } = await prefsQuery;
            const matches = (prefs || []).filter((p) => {
              const pc = String(p.category || "").toLowerCase();
              const tryCat = (s) => s && pc.includes(String(s).toLowerCase());
              return tryCat(category) || tryCat(assetType);
            });
            if (matches.length > 0) {
              const rankByVendorId = new Map();
              for (const m of matches) {
                const prior = rankByVendorId.get(m.vendor_id);
                if (prior == null || m.rank < prior) {
                  rankByVendorId.set(m.vendor_id, m.rank);
                }
              }
              visible.sort((a, b) => {
                const ra = rankByVendorId.has(a.id) ? rankByVendorId.get(a.id) : 9999;
                const rb = rankByVendorId.has(b.id) ? rankByVendorId.get(b.id) : 9999;
                if (ra !== rb) return ra - rb;
                return (a.name || "").localeCompare(b.name || "");
              });
            }
          }
        }
      }
      // Strip the scope rows from the response (frontend doesn't
      // need them here) and cap to 8 like before.
      const trimmed = visible.slice(0, 8).map((v) => {
        const { vendor_scopes, ...rest } = v;
        return rest;
      });
      return respond(200, { ok: true, vendors: trimmed });
    }

    // ── RECENT MESSAGES (dashboard notification) ──
    // Surfaces ticket_messages created within the last N hours that the
    // caller did NOT author, scoped to tickets in their store access.
    // Used by the Dashboard "Take Action" widget to flag conversations
    // that need a reply.
    if (action === "getRecentMessages") {
      const rawHours = Number((event.queryStringParameters || {}).hours);
      const hours = Number.isFinite(rawHours) && rawHours > 0
        ? Math.min(rawHours, 168) // cap at 7 days
        : 48;
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      const access = await getStoresForUser(supabase, profile);

      const { data, error } = await supabase
        .from("ticket_messages")
        .select(`
          id, ticket_id, user_id, user_name, user_role,
          message, thread_type, created_at,
          tickets!inner(wo_number, store_number, asset_type, status)
        `)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      const filtered = (data || []).filter((m) => {
        // Drop the caller's own messages so we only surface things
        // someone else wrote.
        if (m.user_id && m.user_id === userId) return false;
        // Honor scope when the caller isn't all-stores.
        if (!access.all) {
          const sn = m.tickets?.store_number;
          if (!sn || !access.stores.includes(String(sn))) return false;
        }
        return true;
      }).slice(0, 20);

      const messages = filtered.map((m) => ({
        id:           m.id,
        ticket_id:    m.ticket_id,
        wo_number:    m.tickets?.wo_number || "",
        store_number: m.tickets?.store_number ? String(m.tickets.store_number) : "",
        asset_type:   m.tickets?.asset_type || null,
        ticket_status:m.tickets?.status || null,
        user_name:    m.user_name,
        user_role:    m.user_role,
        message:      m.message,
        thread_type:  m.thread_type,
        created_at:   m.created_at,
      }));
      return respond(200, { ok: true, messages, count: messages.length });
    }

    // ── OPEN WORK ORDER ALERTS ──
    // Powers the dashboard bell widget. Returns a small set of
    // actionable buckets, scoped to the caller's visible stores:
    //   * new24h        — submitted in the last 24h
    //   * awaitingApproval — pending quotes routed to the caller's
    //                        approval tier (DO/SDO/VP)
    //   * emergencies   — Emergency priority OR business-critical,
    //                     not yet in a terminal state
    //   * stuck         — non-terminal tickets with no update in 72h
    //
    // Each bucket caps at 5 preview items + a total count. Total
    // unique tickets across buckets returned for the badge so a
    // ticket counted in two buckets isn't double-counted on the bell.
    if (action === "getOpenWorkOrderAlerts") {
      const access = await getStoresForUser(supabase, profile);
      const role = String(profile.role || "").toLowerCase();

      // Resolve store_number list. Top-of-house roles get "all" but
      // we still pull the full list for the .in() filter.
      let visibleStoreNumbers = null;
      if (access.all) {
        const { data } = await supabase.from("stores").select("number").eq("is_active", true);
        visibleStoreNumbers = (data || []).map((s) => String(s.number));
      } else {
        visibleStoreNumbers = (access.stores || []).map((s) => String(s.number));
      }
      if (!visibleStoreNumbers.length) {
        return respond(200, {
          ok: true,
          groups: emptyAlertGroups(role),
          total_unique_tickets: 0,
        });
      }

      const NON_TERMINAL = ["submitted", "in_progress", "scheduled", "on_site"];
      const dayAgo  = new Date(Date.now() - 24 * 3600_000).toISOString();
      const t72ago  = new Date(Date.now() - 72 * 3600_000).toISOString();

      // 1. New (24h) — just-submitted
      const { data: newRows } = await supabase
        .from("tickets")
        .select("id, wo_number, store_number, asset_type, category, priority, status, date_submitted")
        .in("store_number", visibleStoreNumbers)
        .eq("status", "submitted")
        .gte("date_submitted", dayAgo)
        .order("date_submitted", { ascending: false });

      // 2. Emergencies / business critical, still open
      const { data: emergencyRows } = await supabase
        .from("tickets")
        .select("id, wo_number, store_number, asset_type, category, priority, status, is_business_critical, date_submitted")
        .in("store_number", visibleStoreNumbers)
        .in("status", NON_TERMINAL)
        .or("priority.eq.Emergency,is_business_critical.eq.true")
        .order("date_submitted", { ascending: false });

      // 3. Stuck — non-terminal, no update in 72h
      const { data: stuckRows } = await supabase
        .from("tickets")
        .select("id, wo_number, store_number, asset_type, category, priority, status, updated_at")
        .in("store_number", visibleStoreNumbers)
        .in("status", NON_TERMINAL)
        .lte("updated_at", t72ago)
        .order("updated_at", { ascending: true });

      // 3b. Awaiting your confirmation — completed tickets the
      // store hasn't yet confirmed/closed. closed_by_store=false on
      // a completed row means a vendor said done but no one at the
      // store has signed off yet. Most actionable for GMs but
      // informational for DOs+.
      const { data: awaitingConfirmationRows } = await supabase
        .from("tickets")
        .select("id, wo_number, store_number, asset_type, category, priority, status, completed_at, vendor_name")
        .in("store_number", visibleStoreNumbers)
        .eq("status", "completed")
        .order("completed_at", { ascending: false });

      // 4. Awaiting your approval — pending quotes in caller's tier.
      // GMs / shift managers don't approve quotes; they get an empty
      // bucket. Admin tier sees every pending tier.
      const callerTiers = approvalTiersForRole(role);
      let approvalRows = [];
      if (callerTiers.length) {
        const { data } = await supabase
          .from("ticket_approvals")
          .select(`
            id, ticket_id, approval_tier, requested_by, notes, created_at,
            tickets!inner(id, wo_number, store_number, asset_type, category,
                          priority, status, cost_estimate)
          `)
          .eq("status", "Pending")
          .in("tickets.store_number", visibleStoreNumbers)
          .in("approval_tier", callerTiers)
          .order("created_at", { ascending: false });
        approvalRows = data || [];
      }

      const groups = [
        {
          key:   "new24h",
          label: "New (last 24h)",
          tone:  "info",
          count: (newRows || []).length,
          items: (newRows || []).slice(0, 5).map((t) => ({
            id:           t.id,
            wo_number:    t.wo_number,
            store_number: t.store_number,
            summary:      t.asset_type || t.category || "Service Request",
            priority:     t.priority,
            status:       t.status,
            timestamp:    t.date_submitted,
          })),
        },
        {
          key:   "awaitingApproval",
          label: "Awaiting your approval",
          tone:  "warning",
          count: approvalRows.length,
          items: approvalRows.slice(0, 5).map((a) => ({
            id:            a.tickets?.id || a.ticket_id,
            wo_number:     a.tickets?.wo_number || "—",
            store_number:  a.tickets?.store_number || null,
            summary:       a.tickets?.asset_type || a.tickets?.category || "Quote",
            priority:      a.tickets?.priority || "Standard",
            status:        a.tickets?.status || "submitted",
            timestamp:     a.created_at,
            cost_estimate: a.tickets?.cost_estimate ?? null,
            approval_tier: a.approval_tier,
          })),
        },
        {
          key:   "emergencies",
          label: "Emergency / Business Critical open",
          tone:  "danger",
          count: (emergencyRows || []).length,
          items: (emergencyRows || []).slice(0, 5).map((t) => ({
            id:           t.id,
            wo_number:    t.wo_number,
            store_number: t.store_number,
            summary:      t.asset_type || t.category || "Service Request",
            priority:     t.priority,
            status:       t.status,
            timestamp:    t.date_submitted,
            is_business_critical: t.is_business_critical,
          })),
        },
        {
          key:   "awaitingConfirmation",
          label: "Awaiting your confirmation",
          tone:  "info",
          count: (awaitingConfirmationRows || []).length,
          items: (awaitingConfirmationRows || []).slice(0, 5).map((t) => ({
            id:           t.id,
            wo_number:    t.wo_number,
            store_number: t.store_number,
            summary:      t.asset_type || t.category || "Service Request",
            priority:     t.priority,
            status:       t.status,
            timestamp:    t.completed_at,
            vendor_name:  t.vendor_name,
          })),
        },
        {
          key:   "stuck",
          label: "No activity in 3+ days",
          tone:  "neutral",
          count: (stuckRows || []).length,
          items: (stuckRows || []).slice(0, 5).map((t) => ({
            id:           t.id,
            wo_number:    t.wo_number,
            store_number: t.store_number,
            summary:      t.asset_type || t.category || "Service Request",
            priority:     t.priority,
            status:       t.status,
            timestamp:    t.updated_at,
          })),
        },
      ];

      // Total unique tickets across all buckets so the bell badge
      // doesn't double-count emergencies that are also stuck, etc.
      const ids = new Set();
      for (const g of groups) for (const it of g.items) if (it.id) ids.add(it.id);
      // For the badge we want the FULL counts not just preview items.
      // Build a separate id set from raw rows to capture beyond preview.
      const allIds = new Set();
      for (const t of newRows                    || []) allIds.add(t.id);
      for (const t of emergencyRows              || []) allIds.add(t.id);
      for (const t of stuckRows                  || []) allIds.add(t.id);
      for (const t of awaitingConfirmationRows   || []) allIds.add(t.id);
      for (const a of approvalRows) {
        const tid = a.tickets?.id || a.ticket_id;
        if (tid) allIds.add(tid);
      }

      return respond(200, {
        ok: true,
        groups,
        total_unique_tickets: allIds.size,
      });
    }

    // ── MESSAGES ──
    if (action === "getMessages") {
      const { ticketId, threadType } = event.queryStringParameters || {};
      if (!ticketId) {
        return respond(400, { ok: false, message: "ticketId required." });
      }
      const thread = threadType || "internal";
      const { data, error } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .eq("thread_type", thread)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return respond(200, { ok: true, messages: data, threadType: thread });
    }
    if (action === "sendMessage" && event.httpMethod === "POST") {
      const { ticketId, message, threadType } = JSON.parse(event.body);
      if (!ticketId || !message || !message.trim()) {
        return respond(400, {
          ok: false, message: "ticketId and message required.",
        });
      }
      const thread = threadType || "internal";
      const { data, error } = await supabase
        .from("ticket_messages")
        .insert({
          ticket_id:   ticketId,
          user_id:     userId,
          user_name:   userName,
          user_role:   role.toUpperCase(),
          message:     message.trim(),
          thread_type: thread,
        })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, message: data });
    }

    return respond(400, { ok: false, message: "Unknown action." });
  } catch (err) {
    console.error("facilities-v2 error:", err);
    return respond(500, { ok: false, message: err.message || "Server error." });
  }
};
