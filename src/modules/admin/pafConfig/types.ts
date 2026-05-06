// PAF form admin config — shared types used by every editor.
//
// Mirrors the jsonb shape stored in the form_config.config_json column
// (see migration 0015). The runtime guarantee that the loaded config
// matches this type is enforced server-side by validateConfig() in
// netlify/functions/paf-config.js.

export type FieldKey = string;
export type SectionKey =
  | "top"
  | "pay"
  | "tips"
  | "leave"
  | "illness"
  | "store"
  | "term"
  | "demotion"
  | "bonus"
  | "notes";

export interface FieldConfig {
  label: string;
  placeholder: string;
  helpText: string;
  required: boolean;
  visible: boolean;
  locked: boolean;
  /** Which section the field renders in. "top" = above all sections. */
  section: SectionKey;
}

export interface SectionConfig {
  key: SectionKey;
  title: string;
  description: string;
  order: number;
}

export type ListKey =
  | "categories"
  | "positions"
  | "bonusTypes"
  | "statuses"
  | "termTypes";

export interface PafLists {
  categories: string[];
  positions: string[];
  bonusTypes: string[];
  statuses: string[];
  /** Statuses that cannot be removed from `statuses` — only reordered. */
  lockedStatuses: string[];
  termTypes: string[];
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface PafFormConfig {
  fields: Record<FieldKey, FieldConfig>;
  sections: SectionConfig[];
  /** Read-only — which categories trigger which section, from bindCat(). */
  sectionTriggers: Record<SectionKey, string[]>;
  lists: PafLists;
  emailTemplates: Record<string, EmailTemplate>;
}

export interface FormConfigRow {
  id: string;
  config_key: string;
  config_version: number;
  config_json: PafFormConfig;
  change_summary: string | null;
  updated_by: string;
  updated_at: string;
}

export interface FormConfigHistoryEntry {
  id: string;
  config_version: number;
  change_summary: string | null;
  updated_by: string;
  updated_at: string;
}
