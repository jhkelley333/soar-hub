-- Asset type on the manual equipment register, so legacy / direct-purchase
-- entries carry the same "what kind of unit is this" classifier that
-- tickets already have (tickets.asset_type). The Add/Edit equipment modal
-- offers a type-and-search picker sourced from the Issue Library, but the
-- value is stored as free text here (an entry may be a type not yet in the
-- library).

alter table public.equipment_register
  add column if not exists asset_type text;
