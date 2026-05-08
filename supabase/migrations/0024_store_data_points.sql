-- supabase/migrations/0024_store_data_points.sql
--
-- Adds operational + vendor data points to public.stores. Surfaced only
-- on the My Stores → store detail page; not currently exposed via the
-- bulk org import (populate via the Supabase SQL editor or a future
-- inline editor).
--
-- Columns:
--   plate_iq_email             — store-specific Plate IQ inbox
--   soar_company_name          — legal entity / Soar company name on file
--   food_vendor_name           — primary food distributor (e.g. Sysco, US Foods)
--   food_vendor_contact_name   — POC at the vendor
--   food_vendor_contact_phone  — POC phone (free-form: extensions / 800#s allowed)
--   food_vendor_contact_email  — POC email
--   food_vendor_account_number — store's account # with the vendor
--
-- All optional. Idempotent. Apply via the Supabase SQL editor against
-- the Soar Hub v2 project.

alter table stores
  add column if not exists plate_iq_email             text,
  add column if not exists soar_company_name          text,
  add column if not exists food_vendor_name           text,
  add column if not exists food_vendor_contact_name   text,
  add column if not exists food_vendor_contact_phone  text,
  add column if not exists food_vendor_contact_email  text,
  add column if not exists food_vendor_account_number text;

-- Reload PostgREST schema cache so the API picks up the new columns.
notify pgrst, 'reload schema';
