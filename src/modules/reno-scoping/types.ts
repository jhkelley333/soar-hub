// Type definitions mirroring the reno_scoping schema (0066 + 0067).

export type ScopeTier =
  | "existing_condition"
  | "minimum_standard"
  | "plus_up"
  | "optional";

export type ScopeItemStatus = "pass" | "fail" | "needs_work" | "na";

export type ScopeStatus =
  | "draft"
  | "submitted"
  | "reviewed"
  | "needs_revision"
  | "approved";

export type BuildingType =
  | "center_tower_curved"
  | "dt_tower_curved"
  | "center_tower_flat"
  | "brick_stone";

export type RenoCohort = "cohort_1" | "cohort_2" | "cohort_3";

export type ScopeInputType =
  | "pass_fail_needs_work"
  | "yes_no"
  | "measurement"
  | "multi_select";

export interface ScopeTemplate {
  id: string;
  name: string;
  module_type: string;
  version: string;
  is_active: boolean;
}

export interface ScopeTemplateItem {
  id: string;
  template_id: string;
  category: string;
  subcategory: string | null;
  sort_order: number;
  item_label: string;
  item_description: string | null;
  tier: ScopeTier;
  input_type: ScopeInputType;
  photo_required: boolean;
  applies_to_building_types: BuildingType[];
  required_for_building_types: BuildingType[] | null;
}

export interface ScopePhotoSlot {
  id: string;
  template_id: string;
  slot_number: number;
  slot_name: string;
  is_required: boolean;
  is_conditional: boolean;
  sort_order: number;
}

export interface RenoScope {
  id: string;
  store_id: string;
  scoped_by: string;
  scope_date: string;        // YYYY-MM-DD
  building_type: BuildingType;
  cohort: RenoCohort | null;
  template_id: string;
  preferred_signage_vendor: string | null;
  preferred_canopy_vendor: string | null;
  preferred_gc: string | null;
  preferred_paint_contractor: string | null;
  status: ScopeStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
}

// List-view row: scope + denormalized store name/number + scoper name.
export interface RenoScopeRow extends RenoScope {
  store: {
    id: string;
    number: string;
    name: string;
    state: string | null;
  };
  scoper: {
    id: string;
    full_name: string | null;
    email: string;
  } | null;
}

export interface RenoScopeItem {
  id: string;
  scope_id: string;
  template_item_id: string;
  status: ScopeItemStatus | null;
  notes: string | null;
  estimated_cost: number | null;
  recommend_for_plus_up: boolean | null;
}

export interface RenoScopePhoto {
  id: string;
  scope_id: string;
  scope_item_id: string | null;
  photo_slot_id: string | null;
  storage_path: string;
  caption: string | null;
  taken_at: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface RenoScopeNote {
  id: string;
  scope_id: string;
  note_text: string;
  created_by: string;
  created_at: string;
}

// ---- helpers ---------------------------------------------------------

export const TIER_ORDER: ScopeTier[] = [
  "existing_condition",
  "minimum_standard",
  "plus_up",
  "optional",
];

export const TIER_LABELS: Record<ScopeTier, string> = {
  existing_condition: "Existing Conditions",
  minimum_standard: "Minimum Standard",
  plus_up: "Plus-Ups",
  optional: "Optional",
};

export const STATUS_LABELS: Record<ScopeStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  reviewed: "Reviewed",
  needs_revision: "Needs Revision",
  approved: "Approved",
};

export const BUILDING_TYPE_LABELS: Record<BuildingType, string> = {
  center_tower_curved: "Center Tower (Curved)",
  dt_tower_curved: "DT Tower (Curved)",
  center_tower_flat: "Center Tower (Flat)",
  brick_stone: "Brick / Stone",
};

export const COHORT_LABELS: Record<RenoCohort, string> = {
  cohort_1: "Cohort 1 (TX/AZ/NM)",
  cohort_2: "Cohort 2 (Tier-2 states)",
  cohort_3: "Cohort 3 (Remainder)",
};

export const ITEM_STATUS_LABELS: Record<ScopeItemStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  needs_work: "Needs Work",
  na: "N/A",
};

// Lenticulars rule: an item is required for the chosen building type
// when required_for_building_types is null (default: all applies_to)
// OR when the building type is in the explicit array.
export function itemRequiredForBuilding(
  item: Pick<ScopeTemplateItem, "applies_to_building_types" | "required_for_building_types">,
  building: BuildingType
): boolean {
  if (!item.applies_to_building_types.includes(building)) return false;
  if (!item.required_for_building_types) return true;
  return item.required_for_building_types.includes(building);
}
