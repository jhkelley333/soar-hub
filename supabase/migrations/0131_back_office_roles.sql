-- supabase/migrations/0131_back_office_roles.sql
--
-- Add three horizontal back-office roles to user_role, alongside payroll:
--   accounting        — Cash Management deposit/slip review, PAF visibility
--   facilities        — Work Orders (maintenance/construction)
--   human_resources   — PAF, Employee Actions, My Team
--
-- These sit OUTSIDE the store hierarchy. role_level() already returns null
-- for any value it doesn't explicitly list (see 0002 `else null`), so these
-- map to null automatically — module access is granted per-feature in the app
-- layer (nav/route allowlists), not by tier comparison. No role_level change.
--
-- IMPORTANT (Postgres): `ALTER TYPE ... ADD VALUE` can't be USED in the same
-- transaction it's added. Nothing here uses the new values, so this single
-- block is safe to run as-is in the Supabase SQL editor. Each guarded with
-- IF NOT EXISTS so re-running is a no-op.

alter type user_role add value if not exists 'accounting'      before 'admin';
alter type user_role add value if not exists 'facilities'      before 'admin';
alter type user_role add value if not exists 'human_resources' before 'admin';
