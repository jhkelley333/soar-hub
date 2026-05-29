-- supabase/migrations/0110_seed_wo2_new_ui_flag.sql
--
-- Seed the feature flag for the redesigned Work Orders queue/detail
-- (Phase 1 reskin). Disabled globally; preview it by adding your own
-- profile id to allowlist_user_ids via Admin → Feature Flags, then flip
-- `enabled` to true once it's signed off.

insert into feature_flags (key, enabled, notes)
values (
  'wo2_new_ui',
  false,
  'Redesigned Work Orders queue + detail (Phase 1 reskin). Enable globally, or add your user id to the allowlist to preview.'
)
on conflict (key) do nothing;
