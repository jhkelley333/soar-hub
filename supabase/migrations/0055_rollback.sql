-- supabase/migrations/0055_rollback.sql
--
-- Reverses 0055_replacement_equipment.sql.
--
-- Note: Postgres does NOT support removing a value from an enum
-- type once it's been added. The 'awaiting_equipment' enum value
-- will remain. To fully reverse, you'd need to drop the type and
-- recreate it (which requires dropping any column / index that
-- references it). Not worth the risk in a rollback script.
--
-- The columns and index this drops are safe to remove.

drop index if exists tickets_replacement_eta_idx;
alter table public.tickets
  drop column if exists replacement_model,
  drop column if exists replacement_supplier,
  drop column if exists replacement_cost,
  drop column if exists replacement_eta,
  drop column if exists replacement_ordered_at;

notify pgrst, 'reload schema';
