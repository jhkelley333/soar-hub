// Shared status metadata for the Employee Action module: pill color + a
// "who are we waiting on" hint. Kept in one place so the queue, history list,
// and detail drawer stay in sync.

import type { StatusPillKind } from "@/shared/ui/StatusPill";

export function statusKind(status: string): StatusPillKind {
  // Green only for the truly finished states.
  if (status === "Completed" || status === "Closed") return "approved";
  // Sent back to the submitter — its own lane.
  if (status === "Changes Requested") return "revision";
  // Everything else is still waiting on someone to act — flag it red so it
  // never reads as done (incl. the interim "Approved" / "SDO/RVP Approved",
  // which still need the weekly-sheet / PAF step).
  return "waiting";
}

// The role/party the request is currently waiting on, or null when it's done.
// Rendered as "→ Waiting on {who}" next to the status.
export function waitingOn(kind: "training" | "pto", status: string): string | null {
  if (status === "Changes Requested") return "submitter";
  if (kind === "training") {
    if (status === "Submitted" || status === "Approved") return "SDO/RVP";
    if (status === "On Weekly Sheet") return "DO";
    return null; // Completed
  }
  // pto
  if (status === "Submitted") return "DO";
  if (status === "DO Approved") return "SDO/RVP";
  if (status === "SDO/RVP Approved") return "DO";
  if (status === "PAF Submitted") return "DO";
  return null; // Closed
}
