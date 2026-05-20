-- supabase/migrations/0051_feature_flag_paf_pilot.sql
--
-- Seeds the paf_pilot feature flag so the PAF module can be gated to
-- a hand-picked test cohort during pilot. Default state:
--   * enabled = false              → not on for everyone
--   * allowlist_user_ids = '{}'    → admin manages from
--                                     /admin/feature-flags after deploy
--
-- The route guard combines this flag with role: payroll + admin always
-- get in; anyone on the user allowlist also gets in regardless of role.
--
-- Idempotent — re-running won't reset enabled or wipe allowlists.

insert into feature_flags (key, notes) values
  ('paf_pilot',
   'PAF module pilot. Anyone in allowlist_user_ids gets PAF access even '
   || 'if their role isn''t payroll/admin. Used to let specific DOs/RVPs '
   || 'test PAF before broadening it back to the full DO+ role list.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
