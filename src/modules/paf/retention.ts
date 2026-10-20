// PAF retention rules. PAFs (and their attachments) are legal records held for
// RETENTION_YEARS from submission. These helpers are pure so the archive page,
// CSV export, and printout all derive the same dates/flags.

import type { PafRow } from "./types";

export const RETENTION_YEARS = 7;

// The date a PAF may be disposed of: submission date + RETENTION_YEARS.
export function retainUntil(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + RETENTION_YEARS);
  return d.toISOString().slice(0, 10);
}

// Has the retention window elapsed? (Nothing in a young system will have, but
// the archive should say so plainly once records age out.)
export function retentionMet(createdAt: string, today: Date = new Date()): boolean {
  const until = retainUntil(createdAt);
  return !!until && until <= today.toISOString().slice(0, 10);
}

// Categories that must carry a signed attachment on file. Today only the New
// Hire (Salary Leader) offer letter is a required document; the submit form
// enforces it, but older/edited records can still slip through, so the archive
// flags any that are missing it.
export function expectsAttachment(p: PafRow): boolean {
  return p.category === "New Hire (Salary Leader)";
}

export function missingAttachment(p: PafRow): boolean {
  return expectsAttachment(p) && !p.nh_offer_letter_path;
}
