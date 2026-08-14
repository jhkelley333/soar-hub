-- 0289_acquisition_store_email.sql
-- Capture the store's own email in acquisition staging (distinct from the GM
-- email). On merge it's written to stores.email along with the store phone.
alter table acquisition_stores add column if not exists store_email text;

notify pgrst, 'reload schema';
