// Ranker — one-line narrative sentence rendered in the Store View hero.
// This is a *quick* heuristic summary, not the AI-generated long-form
// weekly summary (that lives in AISummaryPanel + ranker-summary.js).

import type { StoreDashboardResponse } from "./types";
import { num } from "./format";

export function buildNarrative(data: StoreDashboardResponse): string {
  if (!data.found || !data.metrics) {
    return "Performance is stable. Maintain execution discipline this week.";
  }
  const m = data.metrics;
  const pm = data.priorMetrics ?? null;
  const rm = data.rankMovement ?? null;

  const parts: string[] = [];

  if (rm && rm.change < 0) {
    parts.push(`rank improved ${Math.abs(rm.change)} spots`);
  } else if (rm && rm.change > 0) {
    parts.push(`rank slipped ${rm.change} spots`);
  }

  const sales = num(m.weeklySales);
  const psales = num(pm?.weeklySales ?? null);
  if (sales !== null && psales !== null) {
    parts.push(
      sales > psales
        ? "sales momentum is building"
        : "sales are softer than last week",
    );
  }

  const labor = num(m.laborPct);
  if (labor !== null) {
    parts.push(
      labor <= 26
        ? "labor is well-controlled"
        : labor >= 30
          ? "labor is running elevated"
          : "labor is in range",
    );
  }

  const v = num(m.vogCount);
  if (v !== null) {
    parts.push(
      v >= 21 ? "VOG is on target" : "VOG count is below the 21-mark",
    );
  }

  if (parts.length === 0) {
    return "Performance is stable. Maintain execution discipline this week.";
  }

  // Capitalize the first letter so the sentence reads naturally regardless
  // of which clause won the leading slot.
  const joined = parts.join(" · ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}
