// Walkthrough builder — the editable draft shape + factory defaults.
//
// A TemplateDraft is a WalkthroughTemplate in progress: id is absent until
// the first save, and isActive controls whether the runner/assignments can
// pick it up. Everything else mirrors the runtime template so "publish" is a
// straight map to the walkthrough_templates row.

import type {
  ScoringMap,
  TemplateItem,
  TemplateSection,
  WalkthroughTemplate,
} from "../types";

export interface TemplateDraft {
  id?: string;
  name: string;
  type: WalkthroughTemplate["type"];
  version: string;
  sections: TemplateSection[];
  scoring: ScoringMap;
  tiers: { green: number; yellow: number };
  globalRules: { photoOnEveryFail?: boolean; allowNa?: boolean };
  isActive: boolean;
  /** Public/self-serve: anyone can start it from My Walks at their store. */
  isPublic: boolean;
}

export const DEFAULT_SCORING: ScoringMap = { pass: 1, watch: 0.6, fail: 0 };
export const DEFAULT_TIERS = { green: 85, yellow: 70 };

export function emptyDraft(): TemplateDraft {
  return {
    name: "",
    type: "walkthrough",
    version: "1.0",
    sections: [],
    scoring: { ...DEFAULT_SCORING },
    tiers: { ...DEFAULT_TIERS },
    globalRules: { photoOnEveryFail: true, allowNa: false },
    isActive: false,
    isPublic: false,
  };
}

export function emptyItem(code: string): TemplateItem {
  return { code, label: "", weight: 1, severity: "med", allowNa: false, rules: [] };
}

export function emptySection(code: string): TemplateSection {
  return { code, name: "", items: [emptyItem(`${code}.01`)] };
}
