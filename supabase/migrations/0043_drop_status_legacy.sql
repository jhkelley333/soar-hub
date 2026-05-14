-- supabase/migrations/0043_drop_status_legacy.sql
--
-- PR 3 cleanup: drop the status_legacy_text column from tickets.
--
-- This column was kept by 0042 as a rollback safety net for one
-- release cycle. We're past that window — Phase 1 is live and stable.
-- Dropping it removes the dual-write contract: from here on, `status`
-- (the v2 enum) is the only source of truth.
--
-- The rollback file (0043_rollback.sql) re-adds the column by computing
-- the legacy text label from the current enum + pause_state. Not a
-- perfect reverse of the original since on_site / completed / cancelled
-- have no legacy equivalent, but close enough for emergency.
--
-- Also archives the wo2_status_v2 feature flag row: marks enabled=true
-- and updates notes to reflect the permanent-on state. The row stays
-- in feature_flags for audit/history; the consuming code is gone so
-- the value no longer affects behavior.

alter table tickets drop column if exists status_legacy_text;

update feature_flags
set enabled = true,
    allowlist_stores = '{}',
    allowlist_user_ids = '{}',
    notes = 'ARCHIVED: Phase 1 cleanup complete. The wo2_status_v2 UI ' ||
            'and dual-write API responses are now unconditional. This ' ||
            'row is preserved for audit history but no code consumes ' ||
            'it. Safe to delete after one more release.'
where key = 'wo2_status_v2';

notify pgrst, 'reload schema';
