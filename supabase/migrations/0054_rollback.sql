-- supabase/migrations/0054_rollback.sql
--
-- Reverses 0054_vendor_is_internal.sql.

drop index if exists vendors_is_internal_idx;
alter table public.vendors drop column if exists is_internal;

notify pgrst, 'reload schema';
