-- supabase/migrations/0106_store_security_vendor_phone.sql
--
-- Adds a contact phone for the store's security vendor (pairs with the
-- security_vendor name added in 0104). Free text so extensions / notes
-- like "(555) 123-4567 ext 9" are allowed, matching food_vendor_contact_phone.

alter table stores
  add column if not exists security_vendor_phone text;

notify pgrst, 'reload schema';
