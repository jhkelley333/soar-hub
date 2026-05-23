// Placeholder scoring + tier classification for the Region rollup page.
//
// PREVIEW ONLY — none of these numbers come from real operational data
// yet. The whole point is to give the design a shape to live in while
// the real scoring formula is being designed.
//
// TODO(scoring): replace these with a real composite (WO backlog + PAF
// approval rate + walkthrough completion + ...). When that lands, this
// file collapses to a thin export of the new helpers and the call sites
// won't move.

import type { Tier } from "@/shared/ui/Tier";

/** Hash a string to a small uniform-ish integer. djb2 — stable across
 *  reloads so a given store always lands on the same fake score. */
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Pseudo "open work order count" — deterministic per store. Replace
 *  with a real WO query once we wire that in. */
export function placeholderOpenWorkOrders(storeId: string): number {
  return hashCode(storeId) % 6; // 0..5
}

/** Tier from a WO count: red 3+, yellow 1-2, green 0. */
export function tierFromOpenWorkOrders(open: number): Tier {
  if (open >= 3) return "red";
  if (open >= 1) return "yellow";
  return "green";
}

/** Score 0-100 derived from the same proxy. Green stores cluster 85-95,
 *  yellow 70-82, red 55-68 so the donut visually matches the tier
 *  without us needing to commit to a real formula yet. */
export function placeholderScore(storeId: string, open: number): number {
  const jitter = hashCode(storeId + ":score") % 11; // 0..10
  if (open === 0) return 85 + jitter;     // green
  if (open <= 2) return 70 + jitter;      // yellow
  return 55 + (jitter % 14);              // red — 55..68
}

/** Trend +/- vs last week. Stubbed at 0 — we don't have weekly history
 *  to diff against yet. */
export function placeholderTrend(_storeId: string): number {
  return 0;
}

/** 10-point sparkline. Pseudo-sinusoidal around the current score so
 *  each store gets a unique-looking curve. Aesthetic only. */
export function placeholderSparkline(storeId: string, score: number): number[] {
  const seed = hashCode(storeId);
  return Array.from({ length: 10 }, (_, i) => {
    const wobble = Math.sin((seed + i * 7) * 0.4) * 6;
    return Math.max(40, Math.min(100, score + wobble + (i - 5) * 0.4));
  });
}
