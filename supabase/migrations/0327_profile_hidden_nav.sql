-- 0327_profile_hidden_nav.sql
-- Per-user list of sidebar modules the user has chosen to hide (COO Command Center settings).

-- Each entry is a NAV `to` path (e.g. '/admin/work-orders-v2'). Hiding only
-- removes the row from that user's own sidebar; routes and role access are
-- unchanged. Written by the user through the existing profiles_update_self
-- policy (id = auth.uid()), so no new policy is needed.
alter table public.profiles
  add column if not exists hidden_nav text[] not null default '{}';

notify pgrst, 'reload schema';
