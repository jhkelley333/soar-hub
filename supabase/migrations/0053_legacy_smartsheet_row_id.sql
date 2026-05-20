-- supabase/migrations/0053_legacy_smartsheet_row_id.sql
--
-- Adds tickets.legacy_smartsheet_row_id so the Smartsheet → WO2 import
-- can be re-run safely. Each Smartsheet row has a stable numeric id;
-- we store it as text (Smartsheet ids are big ints, easiest to keep
-- as text on our side). A partial unique index enforces "one ticket
-- per legacy row" while leaving v2-native tickets (column null)
-- unconstrained.
--
-- Rollback path: `delete from tickets where legacy_smartsheet_row_id
-- is not null;` removes everything the importer touched.

alter table tickets
  add column if not exists legacy_smartsheet_row_id text;

create unique index if not exists idx_tickets_legacy_smartsheet
  on tickets (legacy_smartsheet_row_id)
  where legacy_smartsheet_row_id is not null;

notify pgrst, 'reload schema';
