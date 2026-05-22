// netlify/functions/reno-scoping.js
//
// Service-role backend for Reno Scoping. Two actions:
//
//   POST ?action=transition  (auth: bearer JWT)
//     body: { scope_id, to_status, review_notes? }
//     -> updates reno_scopes.status (+ submitted_at / reviewed_at /
//        reviewed_by / review_notes as appropriate) and inserts an
//        audit row. Role-gated:
//           submitted        — scoper only, from draft|needs_revision
//           reviewed         — DO+ only
//           needs_revision   — DO+ only, from submitted|reviewed|approved
//           approved         — DO+ only
//           draft / reopen   — DO+ only, from approved (Reopen Review)
//
//   POST ?action=update-store-attributes  (auth: bearer JWT)
//     body: { scope_id, attributes }
//     -> patches a whitelisted subset of stores.* using service role,
//        gated to the scope's scoper (during draft / needs_revision) or
//        any DO+ on the scope.
//
// Pattern lifted from netlify/functions/paf.js — same admin() +
// getSessionUser() helpers, same logAudit() shape.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROLE_LEVEL = {
  shift_manager: 10,
  gm: 20,
  do: 30,
  sdo: 40,
  rvp: 50,
  vp: 60,
  coo: 70,
  admin: 100,
  payroll: null,
};

const VALID_TO_STATUS = new Set([
  "draft",
  "submitted",
  "reviewed",
  "needs_revision",
  "approved",
]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("reno-scoping env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const supa = admin();
  const { data: userRes, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userRes?.user) return null;

  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function logAudit(supa, entry) {
  try {
    const { error } = await supa.from("reno_scope_audit_log").insert(entry);
    if (error) console.warn("[reno-scoping] audit log insert failed", error);
  } catch (e) {
    console.warn("[reno-scoping] audit log insert threw", e);
  }
}

// ---- transition action -----------------------------------------------

function authorizeTransition(profile, scope, toStatus) {
  const level = ROLE_LEVEL[profile.role] ?? -1;
  const isScoper = scope.scoped_by === profile.id;
  const isReviewer = level >= ROLE_LEVEL.do; // DO+

  switch (toStatus) {
    case "submitted":
      // Scoper submits; DO+ may also bump (e.g. reopening) — allow both.
      return (
        (isScoper && (scope.status === "draft" || scope.status === "needs_revision")) ||
        (isReviewer && scope.status === "approved") // "Reopen review"
      );
    case "reviewed":
      return isReviewer;
    case "needs_revision":
      return (
        isReviewer &&
        (scope.status === "submitted" ||
          scope.status === "reviewed" ||
          scope.status === "approved")
      );
    case "approved":
      return isReviewer;
    case "draft":
      // Admin can yank a scope back to draft if needed.
      return profile.role === "admin";
    default:
      return false;
  }
}

function actionFor(toStatus, fromStatus) {
  if (toStatus === "submitted" && fromStatus === "approved") return "reopen";
  return toStatus; // matches the action column convention
}

async function handleTransition(event, profile) {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }
  const { scope_id, to_status, review_notes } = body;
  if (!scope_id || typeof scope_id !== "string") {
    return respond(400, { error: "scope_id is required" });
  }
  if (!VALID_TO_STATUS.has(to_status)) {
    return respond(400, { error: `Invalid to_status: ${to_status}` });
  }

  const supa = admin();
  const { data: scope, error: loadErr } = await supa
    .from("reno_scopes")
    .select("id, scoped_by, status, store_id")
    .eq("id", scope_id)
    .single();
  if (loadErr || !scope) {
    return respond(404, { error: "Scope not found" });
  }

  if (!authorizeTransition(profile, scope, to_status)) {
    return respond(403, {
      error: `Not authorized to transition ${scope.status} → ${to_status}`,
    });
  }

  const patch = { status: to_status };
  if (to_status === "submitted") {
    patch.submitted_at = new Date().toISOString();
  }
  if (
    to_status === "reviewed" ||
    to_status === "needs_revision" ||
    to_status === "approved"
  ) {
    patch.reviewed_at = new Date().toISOString();
    patch.reviewed_by = profile.id;
    if (review_notes !== undefined) {
      patch.review_notes = review_notes;
    }
  }
  // When reopening (approved → submitted) clear the prior review_notes
  // so the next reviewer starts clean.
  if (to_status === "submitted" && scope.status === "approved") {
    patch.review_notes = null;
    patch.reviewed_at = null;
    patch.reviewed_by = null;
  }

  const { data: updated, error: updateErr } = await supa
    .from("reno_scopes")
    .update(patch)
    .eq("id", scope_id)
    .select("*")
    .single();
  if (updateErr) {
    return respond(500, { error: updateErr.message });
  }

  await logAudit(supa, {
    scope_id,
    actor_id: profile.id,
    actor_email: profile.email,
    action: actionFor(to_status, scope.status),
    from_status: scope.status,
    to_status,
    detail: review_notes ? { review_notes } : null,
  });

  return respond(200, { scope: updated });
}

// ---- update-store-attributes action ---------------------------------
// Whitelist of stores.* columns the scope-bound attribute editor can
// patch. Keeps the function from being a generic admin write path.

const ATTRIBUTE_COLUMNS = new Set([
  // Stall data (added in earlier migration)
  "patio_pop_menu_count",
  "patio_pop_stall_numbers",
  "order_ahead_stall_count",
  "order_ahead_stall_numbers",
  "stall_pop_menu_count",
  "stall_pop_stall_numbers",
  "has_trailer_stall",
  "trailer_stall_number",
  // Pre-Con building features (migration 0071)
  "has_stall_canopy",
  "has_clearance_bar",
  "has_dt_order_canopy",
]);

const BOOLEAN_ATTRIBUTE_COLUMNS = new Set([
  "has_trailer_stall",
  "has_stall_canopy",
  "has_clearance_bar",
  "has_dt_order_canopy",
]);

function sanitizeAttributes(input) {
  if (!input || typeof input !== "object") return null;
  const patch = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (!ATTRIBUTE_COLUMNS.has(key)) continue;
    // Type coercion: ints (anything ending _count) come back as numbers,
    // bools per the BOOLEAN whitelist, everything else as nullable text.
    if (key.endsWith("_count")) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) continue;
      patch[key] = Math.floor(n);
    } else if (BOOLEAN_ATTRIBUTE_COLUMNS.has(key)) {
      patch[key] = Boolean(value);
    } else {
      patch[key] = value == null ? null : String(value);
    }
    count += 1;
  }
  return count > 0 ? patch : null;
}

async function handleUpdateStoreAttributes(event, profile) {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }
  const { scope_id, attributes } = body;
  if (!scope_id || typeof scope_id !== "string") {
    return respond(400, { error: "scope_id is required" });
  }

  const patch = sanitizeAttributes(attributes);
  if (!patch) {
    return respond(400, { error: "No valid attribute fields supplied" });
  }

  const supa = admin();
  const { data: scope, error: loadErr } = await supa
    .from("reno_scopes")
    .select("id, scoped_by, status, store_id")
    .eq("id", scope_id)
    .single();
  if (loadErr || !scope) {
    return respond(404, { error: "Scope not found" });
  }

  // Same write-gate as the scope itself: scoper on draft / needs_revision
  // OR DO+ at any time.
  const level = ROLE_LEVEL[profile.role] ?? -1;
  const isScoper = scope.scoped_by === profile.id;
  const isReviewer = level >= ROLE_LEVEL.do;
  const canWrite =
    isReviewer ||
    (isScoper && (scope.status === "draft" || scope.status === "needs_revision"));
  if (!canWrite) {
    return respond(403, {
      error: "Not authorized to update store attributes for this scope",
    });
  }

  const { data: updated, error: updateErr } = await supa
    .from("stores")
    .update(patch)
    .eq("id", scope.store_id)
    .select("id, " + Array.from(ATTRIBUTE_COLUMNS).join(", "))
    .single();
  if (updateErr) {
    return respond(500, { error: updateErr.message });
  }

  await logAudit(supa, {
    scope_id,
    actor_id: profile.id,
    actor_email: profile.email,
    action: "update_attributes",
    from_status: scope.status,
    to_status: scope.status,
    detail: { fields: Object.keys(patch) },
  });

  return respond(200, { store: updated });
}

// ---- HTTP handler ----------------------------------------------------

export const handler = async (event) => {
  const action = event.queryStringParameters?.action;
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }
  const profile = await getSessionUser(event);
  if (!profile) {
    return respond(401, { error: "Not signed in" });
  }
  if (action === "transition") {
    return handleTransition(event, profile);
  }
  if (action === "update-store-attributes") {
    return handleUpdateStoreAttributes(event, profile);
  }
  return respond(400, { error: `Unknown action: ${action}` });
};
