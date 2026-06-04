// Walkthrough — pure scoring + validation helpers.
//
// Shared by the live header progress, the review step, and (later) the
// server submit so the GM sees the exact score/tier the server will write.
// Everything here is pure: (template + draft) → numbers. No I/O.

import type {
  ItemResponse,
  LocalDraft,
  ScoringMap,
  Tier,
  WalkthroughTemplate,
} from "./types";

export const DEFAULT_SCORING: ScoringMap = { pass: 1, watch: 0.6, fail: 0 };

/** Fraction of weight an answer earns. N/A and null are excluded from the
 *  denominator entirely (an unanswered item doesn't drag the score down —
 *  it blocks submit instead, surfaced by `unansweredRequired`). */
function earned(value: ItemResponse["value"], scoring: ScoringMap): number | null {
  switch (value) {
    case "pass":
      return scoring.pass;
    case "watch":
      return scoring.watch;
    case "fail":
      return scoring.fail;
    case "na":
    case null:
    default:
      return null;
  }
}

export function tierFor(score: number, tiers: WalkthroughTemplate["tiers"]): Tier {
  if (score >= tiers.green) return "green";
  if (score >= tiers.yellow) return "yellow";
  return "red";
}

export interface ItemLookup {
  weight: number;
  required: boolean;
}

/** Flatten the template into a code → {weight, required} map. An item is
 *  "required" unless it can be marked N/A; null answers on required items
 *  block submit. */
export function indexTemplate(template: WalkthroughTemplate): Map<string, ItemLookup> {
  const map = new Map<string, ItemLookup>();
  for (const section of template.sections) {
    for (const item of section.items) {
      const canNa = template.globalRules.allowNa && item.allowNa !== false;
      map.set(item.code, { weight: item.weight ?? 1, required: !canNa });
    }
  }
  return map;
}

export interface ScoreResult {
  /** 0–100, rounded. Weighted by item weight, N/A excluded. */
  score: number;
  tier: Tier;
  /** Fails + watches across the whole draft. */
  flagCount: number;
  failCount: number;
  watchCount: number;
  /** Answered (non-null) over total answerable (non-N/A) items. */
  answered: number;
  total: number;
}

export function scoreDraft(
  draft: LocalDraft,
  template: WalkthroughTemplate,
): ScoreResult {
  const scoring = template.scoring ?? DEFAULT_SCORING;
  const index = indexTemplate(template);

  let weightedEarned = 0;
  let weightTotal = 0;
  let failCount = 0;
  let watchCount = 0;
  let answered = 0;
  let total = 0;

  for (const section of draft.sections) {
    for (const resp of section.items) {
      const lk = index.get(resp.itemCode);
      const weight = lk?.weight ?? 1;
      if (resp.value === "fail") failCount++;
      if (resp.value === "watch") watchCount++;
      if (resp.value !== "na") total++;
      if (resp.value != null && resp.value !== "na") answered++;

      const e = earned(resp.value, scoring);
      if (e != null) {
        weightedEarned += e * weight;
        weightTotal += weight;
      }
    }
  }

  const score = weightTotal === 0 ? 0 : Math.round((weightedEarned / weightTotal) * 100);
  return {
    score,
    tier: tierFor(score, template.tiers),
    flagCount: failCount + watchCount,
    failCount,
    watchCount,
    answered,
    total,
  };
}

/** Per-section answered/total for the progress segments. */
export function sectionProgress(
  section: LocalDraft["sections"][number],
): { answered: number; total: number; pct: number } {
  const total = section.items.filter((i) => i.value !== "na").length;
  const answered = section.items.filter(
    (i) => i.value != null && i.value !== "na",
  ).length;
  const pct = total === 0 ? 100 : Math.round((answered / total) * 100);
  return { answered, total, pct };
}
