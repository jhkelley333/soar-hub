-- 0199_manageable_users_fbc_backoffice.sql
-- manageable_users() (last touched in 0137_manageable_users_hourly_roles.sql)
-- predates the back-office roles added in 0131_back_office_roles.sql AND the
-- new fbc role from 0198_fbc_role.sql, so its admin allowlist only lists
-- 'payroll'. Anyone whose role is changed to accounting / facilities /
-- human_resources / fbc disappears from the My Team list even though the
-- profiles row is still there — purely a filter miss.
--
-- This brings the function current: admin's manageable_roles includes every
-- back-office tier and fbc, and the ORDER BY case includes the missing roles
-- so the new tiers sort cleanly at the bottom of the list.
--
-- Idempotent (CREATE OR REPLACE).

create or replace function public.manageable_users(manager_id uuid)
returns setof public.profiles
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
      manageable_roles := hourly || array[
        'gm','do','sdo','rvp','vp','coo','admin',
        'payroll','accounting','facilities','human_resources','fbc'
      ]::user_role[];
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
      when 'accounting'              then 15
      when 'facilities'              then 16
      when 'human_resources'         then 17
      when 'fbc'                     then 18
    end,
    p.full_name nulls last,
    p.email;
end;
$$;

notify pgrst, 'reload schema';
