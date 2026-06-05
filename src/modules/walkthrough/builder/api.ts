// Walkthrough builder — template persistence. Direct-to-Supabase: the
// walkthrough_templates RLS policy (migration 0120) already allows DO+ / admin
// to write, so no service-role function is needed. Maps the camelCase draft to
// the snake_case row on the way out and back.

import { supabase } from "@/lib/supabase";
import type { WalkthroughTemplate } from "../types";
import type { TemplateDraft } from "./types";

const TABLE = "walkthrough_templates";

export interface TemplateRow {
  id: string;
  name: string;
  type: WalkthroughTemplate["type"];
  version: string;
  is_active: boolean;
  is_public?: boolean;
  sections: WalkthroughTemplate["sections"];
  scoring: WalkthroughTemplate["scoring"];
  tiers: WalkthroughTemplate["tiers"];
  global_rules: WalkthroughTemplate["globalRules"];
  updated_at: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  type: WalkthroughTemplate["type"];
  version: string;
  isActive: boolean;
  isPublic: boolean;
  sectionCount: number;
  itemCount: number;
  updatedAt: string;
}

function rowToDraft(row: TemplateRow): TemplateDraft {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    version: row.version,
    sections: row.sections ?? [],
    scoring: row.scoring,
    tiers: row.tiers,
    globalRules: row.global_rules ?? {},
    isActive: row.is_active,
    isPublic: row.is_public ?? false,
  };
}

function draftToRow(draft: TemplateDraft) {
  return {
    name: draft.name.trim(),
    type: draft.type,
    version: draft.version.trim(),
    is_active: draft.isActive,
    is_public: draft.isPublic,
    sections: draft.sections,
    scoring: draft.scoring,
    tiers: draft.tiers,
    global_rules: draft.globalRules,
  };
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, name, type, version, is_active, is_public, sections, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const sections = (r.sections as WalkthroughTemplate["sections"]) ?? [];
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      version: r.version,
      isActive: r.is_active,
      isPublic: !!r.is_public,
      sectionCount: sections.length,
      itemCount: sections.reduce((n, s) => n + (s.items?.length ?? 0), 0),
      updatedAt: r.updated_at,
    };
  });
}

export async function getTemplate(id: string): Promise<TemplateDraft> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).single();
  if (error) throw error;
  return rowToDraft(data as TemplateRow);
}

/** Insert (no id) or update (id present). Returns the saved row id. */
export async function saveTemplate(draft: TemplateDraft): Promise<string> {
  const row = draftToRow(draft);
  if (draft.id) {
    const { error } = await supabase.from(TABLE).update(row).eq("id", draft.id);
    if (error) throw error;
    return draft.id;
  }
  const { data, error } = await supabase.from(TABLE).insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/** Flip active state without opening the editor. */
export async function setTemplateActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

/** Clone a template as a new inactive draft ("… (copy)"). Returns its id. */
export async function duplicateTemplate(id: string): Promise<string> {
  const draft = await getTemplate(id);
  return saveTemplate({ ...draft, id: undefined, name: `${draft.name} (copy)`, isActive: false });
}

/** Distinct stores that have run each template (from submissions). Used for
 *  the "Used by N stores" card stat. RLS scopes to the caller's stores. */
export async function templateStoreUsage(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("walkthrough_submissions")
    .select("template_id, store_id")
    .neq("status", "draft");
  if (error) throw error;
  const byTemplate = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { template_id: string; store_id: string }[]) {
    if (!byTemplate.has(r.template_id)) byTemplate.set(r.template_id, new Set());
    byTemplate.get(r.template_id)!.add(r.store_id);
  }
  const out: Record<string, number> = {};
  for (const [tid, stores] of byTemplate) out[tid] = stores.size;
  return out;
}
