-- Rollback for 0070 — drop the damage-notes columns from reno_scopes.

alter table reno_scopes
  drop column if exists damaged_oa_signs_count,
  drop column if exists damaged_oa_signs_notes;
