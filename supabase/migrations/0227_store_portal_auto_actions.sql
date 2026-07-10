-- 0227_store_portal_auto_actions.sql
-- Closed-loop day-sheet items: a KPI breach (labor over goal) auto-creates
-- an action on the store screen. auto_key makes creation idempotent -- one
-- item per signal per store per day. Unique constraint allows many NULLs,
-- so hand-made actions are unaffected. Pure ASCII.

alter table store_portal_actions
  add column if not exists auto_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_portal_actions_auto_key_uq'
  ) then
    alter table store_portal_actions
      add constraint store_portal_actions_auto_key_uq unique (auto_key);
  end if;
end $$;

notify pgrst, 'reload schema';
