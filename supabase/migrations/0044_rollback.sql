-- supabase/migrations/0044_rollback.sql
--
-- Rollback for the vendor QR portal. Drops both tables and the
-- helper function. No data preservation — visits and tokens go
-- away. If you need the audit trail, dump vendor_visits before
-- running this.

drop function if exists gen_store_qr_token();
drop table if exists vendor_visits;
drop table if exists store_qr_tokens;

notify pgrst, 'reload schema';
