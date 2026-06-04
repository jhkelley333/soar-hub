-- supabase/migrations/0082_replacement_manufacturer.sql
--
-- Order Replacement Equipment refinements:
--   * New column tickets.replacement_manufacturer — the make of the
--     replacement unit (now a required field in the Order Replacement
--     modal, sits alongside the model/SKU).
--
-- Supplier becoming required and the new warranty-document upload need
-- no schema change: replacement_supplier already exists, and warranty
-- docs ride on ticket_photos with upload_type 'replacement_warranty'
-- (no allow-list on that column).
--
-- No enum change, so this can run as a single block.

alter table public.tickets
  add column if not exists replacement_manufacturer text;

notify pgrst, 'reload schema';
