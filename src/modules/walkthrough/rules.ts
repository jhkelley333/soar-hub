// Walkthrough — conditional-rule resolution.
//
// Given a template item, the GM's current value, and the template's global
// rules, decide which follow-ups are active and whether they're satisfied.
// Pure + synchronous so the checklist item can render gating state live and
// the review step can block submit on the same logic the field used.

import type {
  FollowupRule,
  ItemResponse,
  TemplateItem,
  WalkthroughTemplate,
} from "./types";

/** The rule in effect for the current value, with the template's global
 *  photoOnEveryFail folded in. Returns null when the value triggers nothing
 *  (e.g. Pass, N/A) — the UI collapses all follow-ups in that case. */
export function effectiveRule(
  item: TemplateItem,
  value: ItemResponse["value"],
  globalRules: WalkthroughTemplate["globalRules"],
): FollowupRule | null {
  if (value !== "fail" && value !== "watch") return null;

  const base = item.rules?.find((r) => r.trigger === value);

  // Global "require a photo on every Fail" overrides a missing/lower per-item
  // photo requirement. It never lowers a stricter per-item count.
  if (value === "fail" && globalRules.photoOnEveryFail) {
    const merged: FollowupRule = base
      ? { ...base, require: { ...base.require } }
      : { trigger: "fail", require: {}, raiseCorrectiveAction: true };
    merged.require.photo = Math.max(1, merged.require.photo ?? 0);
    return merged;
  }

  return base ?? null;
}

export interface RequirementStatus {
  /** No active rule → nothing to show / nothing gating. */
  active: boolean;
  needReason: boolean;
  haveReason: boolean;
  needNote: boolean;
  haveNote: boolean;
  /** Minimum required photo count (0 = not required). */
  needPhoto: number;
  havePhoto: number;
  /** Whether a corrective action will be raised on submit. */
  raisesCorrectiveAction: boolean;
  /** All required follow-ups present — false blocks submit. */
  satisfied: boolean;
}

export function requirementStatus(
  rule: FollowupRule | null,
  resp: Pick<ItemResponse, "reason" | "note" | "photoIds">,
): RequirementStatus {
  if (!rule) {
    return {
      active: false,
      needReason: false,
      haveReason: false,
      needNote: false,
      haveNote: false,
      needPhoto: 0,
      havePhoto: resp.photoIds?.length ?? 0,
      raisesCorrectiveAction: false,
      satisfied: true,
    };
  }

  const needReason = !!rule.require.reason;
  const needNote = !!rule.require.note;
  const needPhoto = rule.require.photo ?? 0;

  const haveReason = !!resp.reason && resp.reason.trim().length > 0;
  const haveNote = !!resp.note && resp.note.trim().length > 0;
  const havePhoto = resp.photoIds?.length ?? 0;

  const satisfied =
    (!needReason || haveReason) &&
    (!needNote || haveNote) &&
    havePhoto >= needPhoto;

  return {
    active: true,
    needReason,
    haveReason,
    needNote,
    haveNote,
    needPhoto,
    havePhoto,
    raisesCorrectiveAction: rule.trigger === "fail" && rule.raiseCorrectiveAction !== false,
    satisfied,
  };
}

/** Item is fully answerable + its follow-ups are complete. Used by the
 *  review step's "unanswered / incomplete" gate. `null` value on a required
 *  item is handled by scoring.indexTemplate, not here. */
export function itemComplete(
  item: TemplateItem,
  resp: ItemResponse,
  globalRules: WalkthroughTemplate["globalRules"],
): boolean {
  const rule = effectiveRule(item, resp.value, globalRules);
  return requirementStatus(rule, resp).satisfied;
}
