-- supabase/migrations/0104_store_acquisition_pos_security.sql
--
-- Adds three more first-class data points to public.stores so they can
-- be set via the bulk org CSV importer and the Org admin edit modal:
--
--   acquisition_date  — date the store was acquired (nullable)
--   pos_system        — POS vendor / system name (nullable text)
--   security_vendor   — security vendor name (nullable text)
--
-- Note: food_vendor_name already exists from 0024_store_data_points.sql
-- and is wired up alongside these in the same release; no schema work
-- needed for it here.

alter table stores
  add column if not exists acquisition_date date,
  add column if not exists pos_system       text,
  add column if not exists security_vendor  text;

-- Reload PostgREST so the new columns are immediately visible to the API
-- (otherwise the bulk import + admin update will 400 with "column does
-- not exist" until the next nightly reload).
notify pgrst, 'reload schema';
