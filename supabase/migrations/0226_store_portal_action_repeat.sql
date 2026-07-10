-- 0226_store_portal_action_repeat.sql
-- Recurring day-sheet checklist items: an action can repeat daily or weekly
-- (on one weekday). A recurring item counts as done only for the day it was
-- checked, then comes back fresh -- opening checks, pre-rush readiness,
-- closing duties. Pure ASCII.

alter table store_portal_actions
  add column if not exists repeat     text not null default 'none',
  add column if not exists repeat_dow smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_portal_actions_repeat_ck'
  ) then
    alter table store_portal_actions
      add constraint store_portal_actions_repeat_ck
      check (repeat in ('none', 'daily', 'weekly'));
  end if;
end $$;

notify pgrst, 'reload schema';
