// PAF form admin config — shared types used by every editor.
//
// Mirrors the jsonb shape stored in the form_config.config_json column
// (see migration 0015). The runtime guarantee that the loaded config
// matches this type is enforced server-side by validateConfig() in
// netlify/functions/paf-config.js.

export type FieldKey = string;
// Section keys are now open-ended strings to avoid churning this union
// every time the form gains a section. Editors that key off the union
// fall through to a generic case for unknown keys.
export type SectionKey = string;

export interface FieldConfig {
  label: string;
  placeholder: string;
  helpText: string;
  required: boolean;
  visible: boolean;
  locked: boolean;
  /** Legacy single-section assignment. Newer configs use `sections`. */
  section?: SectionKey;
  /** Sections this field renders under (B-2b+). */
  sections?: SectionKey[];
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
  | "payBases"
  | "statuses"
  | "referralTiers"
  | "termTypes";

export interface ReferralTier {
  label: string;
  amount: number;
}

export interface PafLists {
  categories: string[];
  positions: string[];
  bonusTypes: string[];
  payBases?: string[];
  statuses: string[];
  /** Statuses that cannot be removed from `statuses` — only reordered. */
  lockedStatuses: string[];
  referralTiers?: ReferralTier[];
  termTypes?: string[];
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
