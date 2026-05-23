// Amount-based approval routing, off the editable thresholds (0077).
// A quote routes to the lowest ACTIVE tier whose NTE covers it; a caller
// can act if their ladder position (sort_order) is at or above that tier,
// so a higher tier always covers a lower amount (RVP clears an SDO-band
// quote). Above the top active tier it's verbal/Owner territory.

import type { ApprovalThreshold } from "./types";

export function activeThresholds(thr: ApprovalThreshold[]): ApprovalThreshold[] {
  return thr.filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order);
}

export function topActiveThreshold(thr: ApprovalThreshold[]): ApprovalThreshold | null {
  const active = activeThresholds(thr);
  if (!active.length) return null;
  return active.reduce((a, b) => (b.nte_cents > a.nte_cents ? b : a));
}

// Lowest active tier whose NTE covers the amount; null if it's over the
// top active tier (verbal/Owner) or there are no active tiers.
export function requiredApprover(
  amountCents: number,
  thr: ApprovalThreshold[],
): ApprovalThreshold | null {
  return activeThresholds(thr).find((t) => t.nte_cents >= amountCents) ?? null;
}

export function isOverTopTier(amountCents: number, thr: ApprovalThreshold[]): boolean {
  const top = topActiveThreshold(thr);
  return !!top && amountCents > top.nte_cents;
}

// Can this caller approve (or, over the top tier, record a verbal
// approval for) this amount?
export function canApprove(
  role: string | null | undefined,
  amountCents: number,
  thr: ApprovalThreshold[],
): boolean {
  if (!role) return false;
  if (role.toLowerCase() === "admin") return true;
  const callerRow = thr.find((t) => t.role === role.toLowerCase());
  if (!callerRow) return false;
  const top = topActiveThreshold(thr);
  if (top && amountCents > top.nte_cents) {
    return callerRow.sort_order >= top.sort_order;
  }
  const required = requiredApprover(amountCents, thr);
  if (!required) return false;
  return callerRow.sort_order >= required.sort_order;
}
