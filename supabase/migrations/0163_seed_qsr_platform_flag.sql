-- 0163_seed_qsr_platform_flag.sql
--
-- Seeds the qsr_platform feature flag for the SOAR QSR Learning Platform — a
-- new admin-gated module being built inside soar-hub. The module's route + nav
-- are admin-only during the build (so only admins see it); this flag is the
-- toggle we'll flip — enabled / per-store / per-user allowlist from
-- /admin/feature-flags — to broaden access to a pilot cohort at launch.
--
-- Default state:
--   * enabled = false            → not on for non-admins
--   * allowlists empty           → admin manages after deploy
--
-- Idempotent — re-running won't reset enabled or wipe allowlists.

insert into feature_flags (key, enabled, notes) values
  ('qsr_platform', false,
   'SOAR QSR Learning Platform (frontline training). Admin-only during the '
   || 'build; flip enabled / allowlist from /admin/feature-flags to pilot with '
   || 'specific stores or users at launch.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
