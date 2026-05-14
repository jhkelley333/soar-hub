-- Rollback for 0045_parts_ordered_metadata.sql.
-- Drops the check constraint and the three columns. Any data in
-- them is lost; dump it first if you need history.

alter table tickets
  drop constraint if exists tickets_parts_ordered_by_chk;

alter table tickets
  drop column if exists parts_ordered_at,
  drop column if exists parts_ordered_notes,
  drop column if exists parts_ordered_by;

notify pgrst, 'reload schema';
