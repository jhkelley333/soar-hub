// Shared status metadata for the Employee Action module: pill color + a
// "who are we waiting on" hint. Kept in one place so the queue, history list,
// and detail drawer stay in sync.

import type { StatusPillKind } from "@/shared/ui/StatusPill";

export function statusKind(status: string): StatusPillKind {
  if (
    status === "Approved" ||
    status === "SDO/RVP Approved" ||
    status === "Completed" ||
    status === "PAF Submitted"
  )
    return "approved";
  if (status === "Changes Requested") return "revision";
  if (status === "DO Approved" || status === "On Weekly Sheet") return "pending";
  return "submitted";
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
  return null; // PAF Submitted
}
