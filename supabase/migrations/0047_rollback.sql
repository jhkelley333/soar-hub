-- Rollback for 0047_vendor_store_preferences.sql. Drops the
-- preferences table; removes the feature_flag row. Idempotent.

delete from feature_flags where key = 'wo2_strict_vendor_scopes';

drop table if exists vendor_store_preferences;

notify pgrst, 'reload schema';
