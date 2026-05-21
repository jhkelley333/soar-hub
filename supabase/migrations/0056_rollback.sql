-- supabase/migrations/0056_rollback.sql
--
-- Reverses 0056_replacement_capture.sql.

drop index if exists tickets_replacement_asset_tag_idx;

alter table public.tickets
  drop constraint if exists tickets_replacement_warranty_parts_source_chk;

alter table public.tickets
  drop column if exists replacement_asset_tag,
  drop column if exists replacement_po_number,
  drop column if exists replacement_warranty_labor_days,
  drop column if exists replacement_warranty_parts_days,
  drop column if exists replacement_warranty_parts_source;

notify pgrst, 'reload schema';
