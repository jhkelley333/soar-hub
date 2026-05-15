-- Rollback for 0048_warranty_fields.sql. Drops all 9 columns and
-- both check constraints. Any warranty data is lost — dump first
-- if you want to keep it.

drop index if exists idx_tickets_warranty_starts_at;

alter table tickets
  drop constraint if exists tickets_warranty_parts_source_chk;

alter table tickets
  drop column if exists warranty_labor_days,
  drop column if exists warranty_parts_days,
  drop column if exists warranty_parts_source,
  drop column if exists warranty_starts_at,
  drop column if exists warranty_notes;

alter table vendors
  drop constraint if exists vendors_parts_warranty_source_chk;

alter table vendors
  drop column if exists labor_warranty_days,
  drop column if exists parts_warranty_days,
  drop column if exists parts_warranty_source,
  drop column if exists warranty_notes;

notify pgrst, 'reload schema';
