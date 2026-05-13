// Translates between the v1 free-text status values and the v2 enum.
//
// Used in three places:
//   1. updateTicket — accepts old or new values from the client
//      (existing UI still sends old; new UI sends new). Normalizes to
//      the new enum before going through the state machine.
//   2. getTickets / getTicket — every ticket response includes both
//      `status` (new enum) and `status_legacy` (old text), so any
//      legacy consumer keeps working for one release cycle.
//   3. notifyTicketEvent rendering — emails currently use legacy text
//      labels; they keep doing so until templates are reauthored.
//
// The mapping is lossy in one direction (new → old): on_site,
// completed, and cancelled have no v1 equivalent, so we use the
// closest legacy label. The state machine never writes those values
// during PR 1 unless a caller explicitly uses the new endpoints, so
// in practice the loss only matters for callers reading new-only
// states via the legacy field.

// Old text → { status, pause_state }
// pause_state defaults to "none" when not present.
const OLD_TO_NEW = {
  "Received":              { status: "submitted",   pause_state: "none" },
  "Pending Approval":      { status: "submitted",   pause_state: "none" },
  "Approved":              { status: "submitted",   pause_state: "none" },
  "Rejected - See Notes":  { status: "submitted",   pause_state: "none" },
  "Scheduled":             { status: "scheduled",   pause_state: "none" },
  "In Progress":           { status: "in_progress", pause_state: "none" },
  "On Hold":               { status: "in_progress", pause_state: "on_hold" },
  "Part on Order":         { status: "in_progress", pause_state: "awaiting_parts" },
  "New Equipment Ordered": { status: "in_progress", pause_state: "awaiting_replacement" },
  "Closed":                { status: "closed",      pause_state: "none" },
  "Cancelled":             { status: "cancelled",   pause_state: "none" },
};

// New enum → best-fit legacy label, taking pause_state into account
// when the status is in_progress so the legacy consumer sees the
// substatus they're used to.
function legacyLabel(status, pauseState) {
  if (status === "in_progress") {
    switch (pauseState) {
      case "on_hold":              return "On Hold";
      case "awaiting_parts":       return "Part on Order";
      case "awaiting_replacement": return "New Equipment Ordered";
      default:                     return "In Progress";
    }
  }
  switch (status) {
    case "submitted":  return "Received";
    case "scheduled":  return "Scheduled";
    case "on_site":    return "In Progress";  // closest legacy fit
    case "completed":  return "Closed";        // closest legacy fit
    case "closed":     return "Closed";
    case "cancelled":  return "Closed";        // closest legacy fit
    default:           return "Received";
  }
}

export function toNewStatus(legacyOrNew) {
  if (!legacyOrNew) return null;
  const s = String(legacyOrNew);
  // Already a new-style enum value?
  if (["submitted","in_progress","scheduled","on_site","completed","closed","cancelled"].includes(s)) {
    return { status: s, pause_state: null };
  }
  const mapped = OLD_TO_NEW[s];
  if (!mapped) return null;
  return mapped;
}

export function toLegacyStatus(newStatus, pauseState) {
  return legacyLabel(newStatus, pauseState || "none");
}

// Add a `status_legacy` field to one or many ticket rows in-place.
// Caller passes ticket object(s) with `status` and `pause_state` set
// (as returned by Supabase from the new schema).
export function annotateLegacy(ticketOrTickets) {
  if (!ticketOrTickets) return ticketOrTickets;
  if (Array.isArray(ticketOrTickets)) {
    return ticketOrTickets.map((t) => ({
      ...t,
      status_legacy: toLegacyStatus(t.status, t.pause_state),
    }));
  }
  return {
    ...ticketOrTickets,
    status_legacy: toLegacyStatus(ticketOrTickets.status, ticketOrTickets.pause_state),
  };
}
