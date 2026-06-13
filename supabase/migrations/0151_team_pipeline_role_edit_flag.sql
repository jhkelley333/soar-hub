-- 0151_team_pipeline_role_edit_flag.sql
-- Onboarding toggle: allow direct role promote/demote from the member drawer
-- while everyone is being sorted into their seat (seed + bulk import leave
-- people in rough/placeholder roles). Seeded ENABLED so onboarding works
-- immediately; an admin turns it OFF in Admin → Feature Flags once the roster
-- is settled, locking roles back down.
insert into feature_flags (key, enabled, allowlist_stores, allowlist_user_ids, notes)
values (
  'team_pipeline_role_edit',
  true,
  '{}',
  '{}',
  'Team Pipeline — allow direct role changes (promote/demote) in the member drawer during onboarding. Turn OFF once everyone is in the right seat.'
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
