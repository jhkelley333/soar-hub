-- supabase/migrations/0070_reno_scope_damage_notes.sql
--
-- Adds two damage-capture fields to reno_scopes for the Pre-Con flow.
-- The Reno-Scoping UI gains a "Damaged Order Ahead signs" section under
-- the new Pre-Con Check List card; counts + notes here drive a sign
-- replacement order for the GC during reskin.
--
-- Idempotent.

alter table reno_scopes
  add column if not exists damaged_oa_signs_count int not null default 0,
  add column if not exists damaged_oa_signs_notes text;
