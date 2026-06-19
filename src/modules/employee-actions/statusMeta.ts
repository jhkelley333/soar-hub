// Shared status metadata for the Employee Action module: pill color + a
// "who are we waiting on" hint. Kept in one place so the queue, history list,
// and detail drawer stay in sync.

import type { StatusPillKind } from "@/shared/ui/StatusPill";

export function statusKind(status: string): StatusPillKind {
  // Green only for the truly finished states.
  if (status === "Completed" || status === "Closed") return "approved";
  // Withdrawn — no longer needed; muted/grey, out of the active flow.
  if (status === "Withdrawn") return "pending";
  // Sent back to the submitter — its own lane.
  if (status === "Changes Requested") return "revision";
  // Every other status names a stage the request has cleared, so the pill is
  // sky-blue with a green dot ("this stage done"). What's still pending is
  // surfaced separately by the red "→ Waiting on {who}" hint via waitingOn().
  return "stage";
}

// The role/party the request is currently waiting on, or null when it's done.
// Rendered as "→ Waiting on {who}" next to the status.
export function waitingOn(kind: "training" | "pto", status: string): string | null {
  if (status === "Withdrawn") return null; // no longer in flight
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
