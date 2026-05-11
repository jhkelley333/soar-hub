-- supabase/migrations/0032_visible_stores_primary_fallback.sql
--
-- Extends user_visible_stores() so that a user's profile.primary_store_id
-- counts as a visible store even when no matching row exists in user_scopes.
--
-- WHY:
--   Shift managers (and any other role we onboard via the profile.primary_store_id
--   field rather than an explicit user_scopes row) currently get an empty
--   result from user_visible_stores(). That cascades to:
--     - the /my-tree endpoint returning nothing
--     - Make the Right Call drawer showing "no store assigned"
--     - manageable_users() not surfacing them to their GM
--     - contacts/vendors RLS hiding store-tier rows for their own store
--
--   The minimum-impact fix is to add one more UNION branch that pulls
--   profile.primary_store_id directly. Everything downstream that relies on
--   this RPC (org RLS helpers, manageable_users, contacts/vendors RLS,
--   /my-tree) automatically picks up the new behavior.
--
-- SAFETY:
--   - SECURITY DEFINER and search_path preserved (same as 0009 definition).
--   - Adds only a UNION branch; existing rows are unchanged.
--   - Active-flag filter on the primary store keeps deactivated assignments
--     from leaking back in.

create or replace function user_visible_stores(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select role from profiles where id = uid
  )
  -- admin / payroll: every active store
  select s.id
  from stores s
  where s.is_active
    and exists (select 1 from u where role in ('admin','payroll'))

  union

  -- direct store scope
  select us.scope_id
  from user_scopes us
  where us.user_id = uid and us.scope_type = 'store'

  union

  -- district scope -> all stores in that district
  select s.id
  from user_scopes us
  join stores s on s.district_id = us.scope_id
  where us.user_id = uid and us.scope_type = 'district'

  union

  -- area scope -> districts -> stores
  select s.id
  from user_scopes us
  join districts d on d.area_id = us.scope_id
  join stores s on s.district_id = d.id
  where us.user_id = uid and us.scope_type = 'area'

  union

  -- region scope -> areas -> districts -> stores
  select s.id
  from user_scopes us
  join areas a on a.region_id = us.scope_id
  join districts d on d.area_id = a.id
  join stores s on s.district_id = d.id
  where us.user_id = uid and us.scope_type = 'region'

  union

  -- explicit global scope row
  select s.id
  from stores s
  where exists (
    select 1 from user_scopes us
    where us.user_id = uid and us.scope_type = 'global'
  )

  union

  -- profile.primary_store_id fallback: covers shift_managers and any other
  -- role we onboard via primary_store_id without a corresponding user_scopes
  -- row. Filters out deactivated stores so a former assignment doesn't leak.
  select s.id
  from profiles p
  join stores s on s.id = p.primary_store_id
  where p.id = uid
    and p.primary_store_id is not null
    and s.is_active;
$$;
