// Single-entry-point state machine for ticket status transitions.
//
// Every status change MUST go through transition(). The machine
// validates the (from, to) pair against the locked matrix, validates
// the required payload fields, computes the side-effects (callback_of,
// completed_at, closed_at, pause_state auto-reset), and returns
// { updates, activity } for the caller to persist atomically.
//
// Errors are thrown as Error objects with a numeric .statusCode (422
// for invalid transitions / missing fields, 403 for "this transition
// isn't allowed by the caller's tier" — though in v2 that's only
// reachable for capability checks the caller layer applies separately).
//
// The matrix here is the source of truth — the design-doc table maps
// 1-1 to entries in TRANSITIONS.

const REOPEN_GRACE_DAYS = 30;
const REOPEN_GRACE_MS = REOPEN_GRACE_DAYS * 24 * 60 * 60 * 1000;

const ALL_STATUSES = [
  "submitted", "in_progress", "scheduled", "on_site",
  "awaiting_equipment",
  "completed", "closed", "cancelled",
];
const ALL_PAUSE_STATES = ["none", "on_hold", "awaiting_parts", "awaiting_replacement"];

// Required-field validators per transition. Receives `payload`; returns
// null on success, an Error with statusCode 422 on failure.
function requireOneOf(payload, fields, label) {
  for (const f of fields) {
    if (payload?.[f] !== undefined && payload[f] !== null && payload[f] !== "") {
      return null;
    }
  }
  return invalidPayload(`${label} requires one of: ${fields.join(", ")}`, { fields });
}

function requireField(payload, field, label) {
  if (payload?.[field] === undefined || payload[field] === null || payload[field] === "") {
    return invalidPayload(`${label}: missing required field "${field}"`, { field });
  }
  return null;
}

function invalidTransition(from, to) {
  const err = new Error(`Invalid transition from "${from}" to "${to}"`);
  err.statusCode = 422;
  err.code = "invalid_transition";
  err.from = from;
  err.to = to;
  return err;
}

function invalidPayload(message, extra) {
  const err = new Error(message);
  err.statusCode = 422;
  err.code = "missing_required_field";
  Object.assign(err, extra || {});
  return err;
}

// Vendor validators — schedule transitions accept either a vendor_id
// (preferred, links to the vendors table) OR a vendor_name (free text,
// for the common case where a GM calls a vendor that isn't yet in the
// table). The legacy "vendor_id required" version is too strict for
// the operational reality where store users routinely schedule new
// vendors by name.
function validateVendor(payload) {
  const hasId = payload?.vendor_id && String(payload.vendor_id).trim();
  const hasName = payload?.vendor_name && String(payload.vendor_name).trim();
  if (hasId || hasName) return null;
  return invalidPayload(
    "Schedule requires a vendor (pick from the vendor list or enter a name)",
    { field: "vendor_id_or_name" });
}
function vendorSideEffects(payload) {
  const out = {};
  if (payload?.vendor_id) out.vendor_id = payload.vendor_id;
  if (payload?.vendor_name) out.vendor_name = payload.vendor_name;
  return out;
}

// Replacement-equipment validator. Required when transitioning INTO
// awaiting_equipment: the team is committing to order new equipment
// so we need at minimum what they're ordering and what it'll cost.
// supplier + eta are strongly recommended but only enforced softly
// (eta required so the dashboard can flag past-due replacements;
// supplier optional because some orders go through corporate).
function validateReplacement(payload) {
  const e1 = requireField(payload, "replacement_model", "order replacement");
  if (e1) return e1;
  if (payload?.replacement_cost === undefined
      || payload.replacement_cost === null
      || payload.replacement_cost === "") {
    return invalidPayload(
      "order replacement: missing required field \"replacement_cost\"",
      { field: "replacement_cost" });
  }
  const e3 = requireField(payload, "replacement_eta", "order replacement");
  if (e3) return e3;
  return null;
}
function replacementSideEffects(payload) {
  const out = {
    replacement_model:      String(payload.replacement_model).trim(),
    replacement_supplier:   payload.replacement_supplier ? String(payload.replacement_supplier).trim() : null,
    replacement_cost:       Number(payload.replacement_cost),
    replacement_eta:        payload.replacement_eta,
    replacement_ordered_at: nowIso(),
  };
  // Optional capture fields — set if the user provided them at order
  // time. Everything else can be filled in later via the Update Ticket
  // panel. These migrate cleanly into V3 assets.
  if (payload.replacement_asset_tag) {
    out.replacement_asset_tag = String(payload.replacement_asset_tag).trim();
  }
  if (payload.replacement_po_number) {
    out.replacement_po_number = String(payload.replacement_po_number).trim();
  }
  if (payload.replacement_warranty_labor_days !== undefined
      && payload.replacement_warranty_labor_days !== null
      && payload.replacement_warranty_labor_days !== "") {
    const n = Number(payload.replacement_warranty_labor_days);
    if (Number.isFinite(n) && n >= 0) out.replacement_warranty_labor_days = Math.round(n);
  }
  if (payload.replacement_warranty_parts_days !== undefined
      && payload.replacement_warranty_parts_days !== null
      && payload.replacement_warranty_parts_days !== "") {
    const n = Number(payload.replacement_warranty_parts_days);
    if (Number.isFinite(n) && n >= 0) out.replacement_warranty_parts_days = Math.round(n);
  }
  if (payload.replacement_warranty_parts_source) {
    out.replacement_warranty_parts_source = String(payload.replacement_warranty_parts_source);
  }
  return out;
}

// Transition table — keyed `from -> to`. Each entry: validate(payload, ctx)
// returns null|Error; sideEffects(payload, ctx) returns partial updates
// to fold into the ticket row. Both omit pause_state auto-reset —
// that's applied uniformly below.
const TRANSITIONS = {
  "submitted->in_progress":   { validate: () => null,
                                sideEffects: () => ({}) },

  "submitted->scheduled":     { validate: (p) => validateVendor(p),
                                sideEffects: (p) => vendorSideEffects(p) },

  // Skip-forward: vendor walked in cold without a scheduled slot.
  // Same outcome as submitted -> in_progress -> on_site but in one
  // transition. Often the vendor portal path.
  "submitted->on_site":       { validate: () => null,
                                sideEffects: (p) => vendorSideEffects(p) },

  // Skip-forward: work happened entirely off-system. DO discovered
  // it was done after the fact, or vendor self-reported completion
  // without ever marking on_site. resolution_category optional.
  "submitted->completed":     { validate: () => null,
                                sideEffects: (p) => ({
                                  resolution_category: p.resolution_category || null,
                                  ...vendorSideEffects(p),
                                  completed_at: nowIso(),
                                }) },

  "submitted->closed":        { validate: (p) => requireField(p, "store_close_reason", "false-alarm close"),
                                sideEffects: (p) => ({
                                  store_close_reason: p.store_close_reason,
                                  closed_by_store: true,
                                  closed_at: nowIso(),
                                }) },

  "submitted->cancelled":     { validate: (p) => {
                                  const e = requireField(p, "admin_close_reason", "cancellation");
                                  if (e) return e;
                                  // Allowed values:
                                  //   cancelled_by_ops — DO/SDO/admin cancellation
                                  //   cancelled_by_submitter — the original submitter
                                  //     cancelled before any vendor work started
                                  //     (sub-reasons captured in admin_close_notes:
                                  //      false_alarm / duplicate / wrong_store /
                                  //      fixed_self / other)
                                  const allowed = ["cancelled_by_ops", "cancelled_by_submitter"];
                                  if (!allowed.includes(p.admin_close_reason)) {
                                    return invalidPayload(
                                      `cancellation requires admin_close_reason in [${allowed.join(", ")}]`,
                                      { field: "admin_close_reason" });
                                  }
                                  return null;
                                },
                                sideEffects: (p) => ({
                                  admin_close_reason: p.admin_close_reason,
                                  admin_close_notes:  p.admin_close_notes || null,
                                  closed_at: nowIso(),
                                }) },

  "in_progress->scheduled":   { validate: (p) => validateVendor(p),
                                sideEffects: (p) => vendorSideEffects(p) },

  "in_progress->on_site":     { validate: () => null,
                                sideEffects: () => ({}) },

  "in_progress->completed":   { validate: () => null, // resolution_category nullable here
                                sideEffects: (p) => ({
                                  resolution_category: p.resolution_category || null,
                                  completed_at: nowIso(),
                                }) },

  "in_progress->closed":      { validate: (p) => {
                                  // Either store_close_reason OR (admin_close_reason + resolution_category)
                                  if (p.store_close_reason) return null;
                                  const e1 = requireField(p, "admin_close_reason", "admin close");
                                  if (e1) return e1;
                                  const e2 = requireField(p, "resolution_category", "admin close");
                                  if (e2) return e2;
                                  return null;
                                },
                                sideEffects: (p) => ({
                                  ...(p.store_close_reason
                                    ? { store_close_reason: p.store_close_reason, closed_by_store: true }
                                    : { admin_close_reason: p.admin_close_reason,
                                        resolution_category: p.resolution_category,
                                        closed_by_store: false }),
                                  closed_at: nowIso(),
                                }) },

  "in_progress->cancelled":   { validate: (p) => requireField(p, "admin_close_reason", "cancellation"),
                                sideEffects: (p) => ({
                                  admin_close_reason: p.admin_close_reason,
                                  closed_at: nowIso(),
                                }) },

  "scheduled->on_site":       { validate: () => null,
                                sideEffects: () => ({}) },

  // Skip-forward: vendor came, finished the job, but the on_site
  // step was never recorded (busy store, vendor self-reporting from
  // the truck on the way out). resolution_category optional.
  "scheduled->completed":     { validate: () => null,
                                sideEffects: (p) => ({
                                  resolution_category: p.resolution_category || null,
                                  completed_at: nowIso(),
                                }) },

  "scheduled->in_progress":   { validate: () => null,
                                sideEffects: () => ({}) },

  "scheduled->cancelled":     { validate: (p) => requireField(p, "admin_close_reason", "cancellation"),
                                sideEffects: (p) => ({
                                  admin_close_reason: p.admin_close_reason,
                                  closed_at: nowIso(),
                                }) },

  "on_site->completed":       { validate: () => null,
                                sideEffects: () => ({ completed_at: nowIso() }) },

  "on_site->in_progress":     { validate: () => null,
                                sideEffects: () => ({}) },

  "completed->closed":        { validate: () => null,
                                // resolution_category is OPTIONAL on this
                                // transition. Store-side "Confirm Fix" sends
                                // no payload → both columns stay null and
                                // we mark closed_by_store=true. Admin closes
                                // can pass either field. Reporting infers
                                // "verified" from (status='closed' AND
                                // completed_at IS NOT NULL).
                                sideEffects: (p) => ({
                                  ...(p.resolution_category
                                    ? { resolution_category: p.resolution_category }
                                    : {}),
                                  ...(p.admin_close_reason
                                    ? { admin_close_reason: p.admin_close_reason }
                                    : {}),
                                  closed_by_store: !p.admin_close_reason,
                                  closed_at: nowIso(),
                                }) },

  "completed->in_progress":   { validate: (p) => validateReopenReason(p),
                                sideEffects: (p, ctx) => ({
                                  callback_of: ctx.ticketId,
                                  completed_at: null,
                                  closed_at: null,
                                }) },

  "closed->in_progress":      { validate: (p, ctx) => {
                                  // within 30 days of closed_at
                                  if (ctx.closed_at) {
                                    const closedMs = new Date(ctx.closed_at).getTime();
                                    if (!Number.isFinite(closedMs)) {
                                      return invalidPayload(
                                        "ticket closed_at is unreadable",
                                        { field: "closed_at" });
                                    }
                                    if (Date.now() - closedMs > REOPEN_GRACE_MS) {
                                      const err = new Error(
                                        `Ticket was closed more than ${REOPEN_GRACE_DAYS} days ago. Use "Create Related Ticket" instead.`);
                                      err.statusCode = 422;
                                      err.code = "reopen_window_expired";
                                      return err;
                                    }
                                  }
                                  return validateReopenReason(p);
                                },
                                sideEffects: (p, ctx) => ({
                                  callback_of: ctx.ticketId,
                                  closed_at: null,
                                }) },

  // ── Replacement-equipment branch ──
  // The team has decided to replace rather than repair (cost-to-fix
  // too high, equipment too old, etc). Reachable from every active
  // status so the call can be made at any point in the workflow.
  // Side-effects capture model + supplier + cost + ETA so the
  // dashboard can flag past-due deliveries and reporting can total
  // replacement spend.
  "submitted->awaiting_equipment":   { validate:    (p) => validateReplacement(p),
                                       sideEffects: (p) => replacementSideEffects(p) },
  "in_progress->awaiting_equipment": { validate:    (p) => validateReplacement(p),
                                       sideEffects: (p) => replacementSideEffects(p) },
  "scheduled->awaiting_equipment":   { validate:    (p) => validateReplacement(p),
                                       sideEffects: (p) => replacementSideEffects(p) },
  "on_site->awaiting_equipment":     { validate:    (p) => validateReplacement(p),
                                       sideEffects: (p) => replacementSideEffects(p) },

  // Exits from awaiting_equipment.
  //  → in_progress: equipment arrived, scheduling install / installer
  //    is on their way. No extra payload required.
  //  → completed: equipment installed and working. resolution_category
  //    defaults to 'replaced' if not supplied — that's the whole point
  //    of this branch.
  //  → cancelled: changed our minds (won't replace after all). Standard
  //    cancellation rules apply.
  "awaiting_equipment->in_progress": { validate: () => null,
                                       sideEffects: () => ({}) },
  "awaiting_equipment->completed":   { validate: () => null,
                                       sideEffects: (p) => ({
                                         resolution_category: p.resolution_category || "replaced",
                                         completed_at: nowIso(),
                                       }) },
  "awaiting_equipment->closed":      { validate: (p) => {
                                         if (p.store_close_reason) return null;
                                         const e1 = requireField(p, "admin_close_reason", "admin close");
                                         if (e1) return e1;
                                         return null;
                                       },
                                       sideEffects: (p) => ({
                                         ...(p.store_close_reason
                                           ? { store_close_reason: p.store_close_reason, closed_by_store: true }
                                           : { admin_close_reason: p.admin_close_reason,
                                               resolution_category: p.resolution_category || "replaced",
                                               closed_by_store: false }),
                                         closed_at: nowIso(),
                                       }) },
  "awaiting_equipment->cancelled":   { validate: (p) => requireField(p, "admin_close_reason", "cancellation"),
                                       sideEffects: (p) => ({
                                         admin_close_reason: p.admin_close_reason,
                                         closed_at: nowIso(),
                                       }) },
};

function validateReopenReason(payload) {
  const e = requireField(payload, "reopen_reason", "reopen");
  if (e) return e;
  if (payload.reopen_reason === "other") {
    if (!payload.reopen_reason_text || !String(payload.reopen_reason_text).trim()) {
      return invalidPayload(
        'reopen reason "other" requires a non-empty reopen_reason_text',
        { field: "reopen_reason_text" });
    }
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

// Public entry point.
//
// `from` — current ticket.status (new enum value).
// `to`   — target ticket.status (new enum value).
// `payload` — caller-supplied transition payload (reason codes, vendor_id, etc.).
// `ctx`  — { ticketId, closed_at, pause_state, actor: { id, role, tier } }.
//
// Returns:
//   {
//     updates:  partial row to UPDATE on tickets (always includes status; may include
//               pause_state when auto-reset, plus reason fields, callback_of, etc.),
//     activity: row to INSERT into ticket_activities (event_type, event_data, visibility).
//   }
//
// Throws on invalid (from, to) pair or missing payload fields.
export function transition({ from, to, payload = {}, ctx = {} }) {
  if (!ALL_STATUSES.includes(from)) {
    throw invalidPayload(`Unknown from-status "${from}"`, { field: "from" });
  }
  if (!ALL_STATUSES.includes(to)) {
    throw invalidPayload(`Unknown to-status "${to}"`, { field: "to" });
  }
  if (from === to) {
    // No-op transition. Don't write status; let the caller route
    // through edit_ticket for ancillary updates.
    return { updates: {}, activity: null };
  }
  if (from === "cancelled") {
    throw invalidTransition(from, to); // terminal
  }

  const key = `${from}->${to}`;
  const def = TRANSITIONS[key];
  if (!def) throw invalidTransition(from, to);

  const err = def.validate(payload, ctx);
  if (err) throw err;

  const sideEffects = def.sideEffects(payload, ctx) || {};
  const updates = { status: to, ...sideEffects };

  // Pause-state auto-reset: any transition out of (in_progress, scheduled)
  // forces pause_state back to 'none'. Only relevant when ctx.pause_state
  // tells us the ticket is currently paused.
  const fromAllowsPause = from === "in_progress" || from === "scheduled";
  const toAllowsPause   = to   === "in_progress" || to   === "scheduled";
  let pauseResetActivity = null;
  if (fromAllowsPause && !toAllowsPause && ctx.pause_state && ctx.pause_state !== "none") {
    updates.pause_state = "none";
    updates.pause_reason_note = null;
    pauseResetActivity = {
      event_type: "pause_state_changed",
      event_data: {
        from: ctx.pause_state,
        to: "none",
        auto_reset: true,
        triggered_by_transition: `${from}->${to}`,
      },
      visibility: "all",
    };
  }

  // Main activity entry. Caller writes both this and the
  // pauseResetActivity (if present) atomically.
  const activity = {
    event_type: "status_changed",
    event_data: {
      from,
      to,
      reason_code: payload.reopen_reason || payload.store_close_reason
                || payload.admin_close_reason || null,
      reason_text: payload.reopen_reason_text || null,
      resolution_category: payload.resolution_category || null,
      vendor_id: payload.vendor_id || null,
    },
    visibility: "all",
  };

  return {
    updates,
    activity,
    pauseResetActivity,
  };
}

// Standalone pause-state setter. Lives here so callers go through a
// single module for any status/pause mutation. Validates the current
// status allows a pause, and the value is in the enum.
export function setPause({ currentStatus, currentPause, to, reasonNote }) {
  if (!ALL_PAUSE_STATES.includes(to)) {
    throw invalidPayload(`Unknown pause_state "${to}"`, { field: "pause_state" });
  }
  if (to !== "none" && currentStatus !== "in_progress" && currentStatus !== "scheduled") {
    const err = new Error(
      `Pause state can only be set when ticket is in_progress or scheduled (currently "${currentStatus}").`);
    err.statusCode = 422;
    err.code = "invalid_pause_for_status";
    throw err;
  }
  const updates = { pause_state: to };
  if (to === "none") {
    updates.pause_reason_note = null;
  } else if (reasonNote !== undefined) {
    updates.pause_reason_note = reasonNote || null;
  }
  const activity = {
    event_type: "pause_state_changed",
    event_data: {
      from: currentPause || "none",
      to,
      reason_note: reasonNote || null,
      auto_reset: false,
    },
    visibility: "all",
  };
  return { updates, activity };
}

// Used by the reopen-window check above; exported for tests + UI.
export function isWithinReopenGrace(closedAtIso) {
  if (!closedAtIso) return true; // No close timestamp → treat as still in grace
  const ms = new Date(closedAtIso).getTime();
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms <= REOPEN_GRACE_MS;
}

export const REOPEN_GRACE = {
  days: REOPEN_GRACE_DAYS,
  ms:   REOPEN_GRACE_MS,
};
