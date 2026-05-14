// One-way translation from legacy v1 status strings to v2 enum values.
//
// Kept after PR 3 because updateTicket's normalization still accepts
// either spelling — guards against any caller that hasn't been updated
// to send v2 enum values directly. The reverse direction (new → old)
// is preserved for the rare external integration that still expects
// a human-readable status label; it's not auto-attached to API
// responses anymore.

// Old text → { status, pause_state }. pause_state defaults to 'none'.
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

// New enum → best-fit legacy label. Lossy for on_site / completed /
// cancelled. Used by exports / integrations that haven't migrated to
// the v2 enum spelling.
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
