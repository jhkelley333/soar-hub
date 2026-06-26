-- 0191_vendors_address.sql
-- Collect a vendor's street address (the form already captures phone + email).
-- Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

alter table vendors add column if not exists address text;

notify pgrst, 'reload schema';
