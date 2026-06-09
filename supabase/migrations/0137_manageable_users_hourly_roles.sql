-- supabase/migrations/0137_manageable_users_hourly_roles.sql
--
-- Fix: the new hourly store roles (first_assistant_manager, associate_manager,
-- crew_leader, crew_member, carhop) don't appear under My Team.
--
-- manageable_users() (0004 → 0022) builds its manageable_roles arrays from
-- hardcoded role strings that only ever listed 'shift_manager' for the store
-- floor. When the hourly roles were added (0119) they were slotted into
-- role_level() at the shift_manager tier and wired through the app layer, but
-- this function was missed — so `where p.role = any(manageable_roles)` filters
-- them out and My Team never shows them. (My Stores reads the org tree, which
-- is why they appear there.)
--
-- Per product decision the hourly roles carry the SAME access as shift_manager,
-- so they belong everywhere shift_manager appears. This recreates the function
-- with a single `hourly` array injected into each manager's manageable set, and
-- adds the hourly roles to the display ordering (grouped right after
-- shift_manager). Logic is otherwise identical to 0022 — same scope-subset
-- check, same tiers. Idempotent (CREATE OR REPLACE).

create or replace function manageable_users(manager_id uuid)
returns setof profiles
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  manager_role     user_role;
  manageable_roles user_role[];
  org_wide         boolean;
  -- The store-floor tier — all at shift_manager's access level.
  hourly user_role[] := array[
    'shift_manager','first_assistant_manager','associate_manager',
    'crew_leader','crew_member','carhop'
  ]::user_role[];
begin
  select role into manager_role from profiles where id = manager_id and is_active = true;
  if manager_role is null then return; end if;

  case manager_role
    when 'admin' then
      manageable_roles := hourly || array['gm','do','sdo','rvp','vp','coo','admin','payroll']::user_role[];
      org_wide := true;
    when 'coo' then
      manageable_roles := hourly || array['gm','do','sdo','rvp']::user_role[];
      org_wide := true;
    when 'vp' then
      manageable_roles := hourly || array['gm','do','sdo','rvp']::user_role[];
      org_wide := true;
    when 'rvp' then
      manageable_roles := hourly || array['gm','do','sdo']::user_role[];
      org_wide := false;
    when 'sdo' then
      manageable_roles := hourly || array['gm','do']::user_role[];
      org_wide := false;
    when 'do' then
      manageable_roles := hourly || array['gm']::user_role[];
      org_wide := false;
    when 'gm' then
      manageable_roles := hourly;
      org_wide := false;
    else
      return;
  end case;

  return query
  select p.*
  from profiles p
  where p.role = any(manageable_roles)
    and p.id <> manager_id
    and (
      org_wide
      or not exists (
        select 1
        from user_visible_stores(p.id) as target_store_id
        where target_store_id not in (
          select * from user_visible_stores(manager_id)
        )
      )
    )
  order by
    case p.role
      when 'admin'                   then 1
      when 'coo'                     then 2
      when 'vp'                      then 3
      when 'rvp'                     then 4
      when 'sdo'                     then 5
      when 'do'                      then 6
      when 'gm'                      then 7
      when 'shift_manager'           then 8
      when 'first_assistant_manager' then 9
      when 'associate_manager'       then 10
      when 'crew_leader'             then 11
      when 'crew_member'             then 12
      when 'carhop'                  then 13
      when 'payroll'                 then 14
    end,
    p.full_name nulls last,
    p.email;
end;
$$;

notify pgrst, 'reload schema';
