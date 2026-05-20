-- Rollback for 0053_legacy_smartsheet_row_id.sql.
-- Drops the index and column. Run AFTER deleting imported rows if
-- you want them gone:
--   delete from tickets where legacy_smartsheet_row_id is not null;

drop index if exists idx_tickets_legacy_smartsheet;
alter table tickets drop column if exists legacy_smartsheet_row_id;

notify pgrst, 'reload schema';
