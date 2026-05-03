-- supabase/migrations/0006_add_store_phone.sql
--
-- Adds an optional phone column to the stores table so each location can
-- carry its own contact number alongside the address fields. Used in the
-- org hierarchy seed and surfaced in My Team scope chips / future store
-- detail views.
--
-- Storage rule (matches profiles.phone): exactly 10 digits, no formatting,
-- no country-code prefix. Normalize at the app layer before write.
--
-- Idempotent. Apply via the Supabase SQL editor.

alter table stores
  add column if not exists phone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stores_phone_format_ck'
  ) then
    alter table stores
      add constraint stores_phone_format_ck
      check (phone is null or phone ~ '^[0-9]{10}$');
  end if;
end$$;
