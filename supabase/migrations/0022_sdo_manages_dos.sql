-- supabase/migrations/0022_sdo_manages_dos.sql
--
-- Phase: My Team scope correction.
--
-- 0004 grouped SDO + DO into the same manageable-roles bucket
-- (shift_manager + gm only). That was wrong for the SDO tier — in our
-- org, DOs report to the SDO of their area, so an SDO landing on My
-- Team should see their DOs alongside their GMs and Shift Managers.
--
-- Splits the SDO arm into its own case to add 'do'. DO's set is
-- unchanged (shift_manager + gm). Scope check (user_visible_stores
-- subset) still applies, so an SDO only sees DOs whose districts roll
-- up into the SDO's area.

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
begin
  select role into manager_role from profiles where id = manager_id and is_active = true;
  if manager_role is null then return; end if;

  case manager_role
    when 'admin' then
      manageable_roles := array['shift_manager','gm','do','sdo','rvp','vp','coo','admin','payroll']::user_role[];
      org_wide := true;
    when 'coo' then
      manageable_roles := array['shift_manager','gm','do','sdo','rvp']::user_role[];
      org_wide := true;
    when 'vp' then
      manageable_roles := array['shift_manager','gm','do','sdo','rvp']::user_role[];
      org_wide := true;
    when 'rvp' then
      manageable_roles := array['shift_manager','gm','do','sdo']::user_role[];
      org_wide := false;
    when 'sdo' then
      manageable_roles := array['shift_manager','gm','do']::user_role[];
      org_wide := false;
    when 'do' then
      manageable_roles := array['shift_manager','gm']::user_role[];
      org_wide := false;
    when 'gm' then
      manageable_roles := array['shift_manager']::user_role[];
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
      when 'admin'         then 1
      when 'coo'           then 2
      when 'vp'            then 3
      when 'rvp'           then 4
      when 'sdo'           then 5
      when 'do'            then 6
      when 'gm'            then 7
      when 'shift_manager' then 8
      when 'payroll'       then 9
    end,
    p.full_name nulls last,
    p.email;
end;
$$;
