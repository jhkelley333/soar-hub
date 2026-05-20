-- Rollback for 0051_feature_flag_paf_pilot.sql.
-- Drops the seeded flag row. Code referencing useFlag("paf_pilot")
-- falls back to false (off), so the rollback is safe to run before
-- the consuming code is reverted — pilot users just lose access.

delete from feature_flags where key = 'paf_pilot';

notify pgrst, 'reload schema';
