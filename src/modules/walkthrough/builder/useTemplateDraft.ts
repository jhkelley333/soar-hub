// Walkthrough builder — draft state, local autosave, mutators, validation.
//
// Desktop builder, so a single localStorage snapshot (keyed by template id or
// "new") is enough for crash/refresh safety — no Dexie like the field runner.
// All structure edits funnel through here so codes stay consistent and the
// publish gate reads one validation function.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FollowupRule, ItemSeverity, TemplateItem, WalkthroughTemplate } from "../types";
import { emptyDraft, emptyItem, emptySection, type TemplateDraft } from "./types";

const LS_PREFIX = "wt-builder-draft:";

function lsKey(id?: string) {
  return `${LS_PREFIX}${id ?? "new"}`;
}

/** Two-letter-ish section code from a name: "Fryer & Line" → "FRY". */
function sectionCodeFromName(name: string, taken: Set<string>): string {
  const base =
    name
      .replace(/[^a-zA-Z ]/g, "")
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 3) || "SEC";
  let code = base;
  let n = 2;
  while (taken.has(code)) code = `${base}${n++}`;
  return code;
}

export interface DraftValidation {
  problems: string[];
  ok: boolean;
}

export function useTemplateDraft(initial: TemplateDraft | null, id?: string) {
  const [draft, setDraft] = useState<TemplateDraft | null>(initial);
  const [dirty, setDirty] = useState(false);
  const hydrated = useRef(false);

  // Hydrate: prefer a locally-stashed unsaved draft over the server copy.
  useEffect(() => {
    if (hydrated.current || initial == null) return;
    hydrated.current = true;
    try {
      const raw = localStorage.getItem(lsKey(id));
      if (raw) {
        setDraft(JSON.parse(raw) as TemplateDraft);
        setDirty(true);
        return;
      }
    } catch {
      /* ignore */
    }
    setDraft(initial);
  }, [initial, id]);

  // Autosave to localStorage on every change.
  useEffect(() => {
    if (!draft || !dirty) return;
    try {
      localStorage.setItem(lsKey(id), JSON.stringify(draft));
    } catch {
      /* ignore quota */
    }
  }, [draft, dirty, id]);

  const update = useCallback((fn: (d: TemplateDraft) => TemplateDraft) => {
    setDraft((cur) => (cur ? fn(cur) : cur));
    setDirty(true);
  }, []);

  const clearLocal = useCallback(() => {
    try {
      localStorage.removeItem(lsKey(id));
    } catch {
      /* ignore */
    }
    setDirty(false);
  }, [id]);

  // ---- meta ----
  const setMeta = useCallback(
    (patch: Partial<Pick<TemplateDraft, "name" | "type" | "version" | "isActive" | "isPublic">>) =>
      update((d) => ({ ...d, ...patch })),
    [update],
  );

  const setScoring = useCallback(
    (patch: Partial<TemplateDraft["scoring"]>) =>
      update((d) => ({ ...d, scoring: { ...d.scoring, ...patch } })),
    [update],
  );
  const setTiers = useCallback(
    (patch: Partial<TemplateDraft["tiers"]>) =>
      update((d) => ({ ...d, tiers: { ...d.tiers, ...patch } })),
    [update],
  );
  const setGlobalRules = useCallback(
    (patch: Partial<TemplateDraft["globalRules"]>) =>
      update((d) => ({ ...d, globalRules: { ...d.globalRules, ...patch } })),
    [update],
  );

  // ---- sections ----
  const addSection = useCallback(
    () =>
      update((d) => {
        const taken = new Set(d.sections.map((s) => s.code));
        const code = sectionCodeFromName(`Section ${d.sections.length + 1}`, taken);
        return { ...d, sections: [...d.sections, emptySection(code)] };
      }),
    [update],
  );
  const removeSection = useCallback(
    (code: string) => update((d) => ({ ...d, sections: d.sections.filter((s) => s.code !== code) })),
    [update],
  );
  const moveSection = useCallback(
    (code: string, dir: -1 | 1) =>
      update((d) => {
        const i = d.sections.findIndex((s) => s.code === code);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= d.sections.length) return d;
        const next = [...d.sections];
        [next[i], next[j]] = [next[j], next[i]];
        return { ...d, sections: next };
      }),
    [update],
  );
  const setSectionName = useCallback(
    (code: string, name: string) =>
      update((d) => ({
        ...d,
        sections: d.sections.map((s) => (s.code === code ? { ...s, name } : s)),
      })),
    [update],
  );

  // ---- items ----
  const addItem = useCallback(
    (sectionCode: string) =>
      update((d) => ({
        ...d,
        sections: d.sections.map((s) => {
          if (s.code !== sectionCode) return s;
          const n = s.items.length + 1;
          const code = `${s.code}.${String(n).padStart(2, "0")}`;
          return { ...s, items: [...s.items, emptyItem(code)] };
        }),
      })),
    [update],
  );
  const removeItem = useCallback(
    (sectionCode: string, itemCode: string) =>
      update((d) => ({
        ...d,
        sections: d.sections.map((s) =>
          s.code === sectionCode ? { ...s, items: s.items.filter((i) => i.code !== itemCode) } : s,
        ),
      })),
    [update],
  );
  const setItem = useCallback(
    (sectionCode: string, itemCode: string, patch: Partial<TemplateItem>) =>
      update((d) => ({
        ...d,
        sections: d.sections.map((s) =>
          s.code === sectionCode
            ? { ...s, items: s.items.map((i) => (i.code === itemCode ? { ...i, ...patch } : i)) }
            : s,
        ),
      })),
    [update],
  );

  /** Upsert (or remove) the fail/watch rule for an item. Pass null to clear. */
  const setItemRule = useCallback(
    (sectionCode: string, itemCode: string, trigger: "fail" | "watch", rule: FollowupRule | null) =>
      update((d) => ({
        ...d,
        sections: d.sections.map((s) => {
          if (s.code !== sectionCode) return s;
          return {
            ...s,
            items: s.items.map((i) => {
              if (i.code !== itemCode) return i;
              const others = (i.rules ?? []).filter((r) => r.trigger !== trigger);
              return { ...i, rules: rule ? [...others, rule] : others };
            }),
          };
        }),
      })),
    [update],
  );

  const validation: DraftValidation = useMemo(() => {
    const problems: string[] = [];
    if (!draft) return { problems: ["No draft"], ok: false };
    if (!draft.name.trim()) problems.push("Template needs a name");
    if (!draft.version.trim()) problems.push("Template needs a version");
    if (draft.sections.length === 0) problems.push("Add at least one section");
    const codes = new Set<string>();
    for (const s of draft.sections) {
      if (!s.name.trim()) problems.push(`Section ${s.code} needs a name`);
      if (s.items.length === 0) problems.push(`Section "${s.name || s.code}" has no items`);
      for (const it of s.items) {
        if (codes.has(it.code)) problems.push(`Duplicate item code ${it.code}`);
        codes.add(it.code);
        if (!it.label.trim()) problems.push(`Item ${it.code} needs a label`);
        if (it.weight < 0) problems.push(`Item ${it.code} weight can't be negative`);
      }
    }
    const { green, yellow } = draft.tiers;
    if (!(green > yellow)) problems.push("Green threshold must be above Yellow");
    if (green > 100 || yellow < 0) problems.push("Tier thresholds must be within 0–100");
    for (const k of ["pass", "watch", "fail"] as const) {
      const v = draft.scoring[k];
      if (v < 0 || v > 1) problems.push(`Scoring ${k} must be between 0 and 1`);
    }
    return { problems, ok: problems.length === 0 };
  }, [draft]);

  return {
    draft,
    dirty,
    setDirty,
    validation,
    clearLocal,
    setMeta,
    setScoring,
    setTiers,
    setGlobalRules,
    addSection,
    removeSection,
    moveSection,
    setSectionName,
    addItem,
    removeItem,
    setItem,
    setItemRule,
  };
}

export type TemplateDraftStore = ReturnType<typeof useTemplateDraft>;
export const SEVERITIES: ItemSeverity[] = ["low", "med", "high"];
export const TEMPLATE_TYPES: WalkthroughTemplate["type"][] = ["walkthrough", "audit", "safety"];

// Re-export for step components that build empty rows.
export { emptyDraft, emptyItem, emptySection };
