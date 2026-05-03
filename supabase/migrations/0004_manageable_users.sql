-- supabase/migrations/0004_manageable_users.sql
--
-- Phase 2b: who can a given user manage?
--
-- Centralizes the My Team permission rules in one place. Returns the set of
-- profiles a manager is allowed to see + manage based on:
--
--   1. ROLE — manageable role set per manager tier (locked rules):
--        gm    -> shift_manager
--        do    -> shift_manager, gm
--        sdo   -> shift_manager, gm
--        rvp   -> shift_manager, gm, do, sdo
--        vp    -> shift_manager, gm, do, sdo, rvp
--        coo   -> shift_manager, gm, do, sdo, rvp
--        admin -> everyone (incl. other admins / vp / coo)
--        shift_manager / payroll -> nobody
--
--   2. SCOPE — for non-org-wide tiers (gm, do, sdo, rvp), a target user is
--      manageable only if every store they can see is also visible to the
--      manager. Computed via existing user_visible_stores() so we don't
--      re-implement the org tree walk.
--
--      org-wide tiers (vp, coo, admin) bypass the scope check.
--
-- Used by:
--   - netlify/functions/team-mgmt.js (?action=list, change-role, etc.)
--   - any future surface that needs "team within my reach"
--
-- security definer + bound search_path so the RPC is safe to expose to
-- authenticated users — the function only reads, never writes.

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
    when 'sdo', 'do' then
      manageable_roles := array['shift_manager','gm']::user_role[];
      org_wide := false;
    when 'gm' then
      manageable_roles := array['shift_manager']::user_role[];
      org_wide := false;
    else
      return;  -- shift_manager, payroll cannot manage anyone
  end case;

  return query
  select p.*
  from profiles p
  where p.role = any(manageable_roles)
    and p.id <> manager_id  -- can't manage yourself
    and (
      org_wide
      or not exists (
        -- target's visible stores must be a subset of manager's visible
        -- stores. equivalently: there is no store the target can see that
        -- the manager cannot. user_visible_stores() returns setof uuid,
        -- so we compare the bare row value (no column name).
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

comment on function manageable_users(uuid) is
  'Phase 2b: returns profiles a manager can see + change. Encodes the My Team role hierarchy + scope subset rules. SECURITY DEFINER — safe because read-only.';
