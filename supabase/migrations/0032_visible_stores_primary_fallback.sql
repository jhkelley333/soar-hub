-- supabase/migrations/0032_visible_stores_primary_fallback.sql
--
-- Extends user_visible_stores() so profile.primary_store_id counts as a
-- visible store even when no matching user_scopes row exists. Covers shift
-- managers (and any role onboarded via primary_store_id rather than an
-- explicit user_scopes assignment).

create or replace function user_visible_stores(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with u as (select role from profiles where id = uid)
  select s.id from stores s
  where s.is_active and exists (select 1 from u where role in ('admin','payroll'))
  union
  select us.scope_id from user_scopes us
  where us.user_id = uid and us.scope_type = 'store'
  union
  select s.id from user_scopes us
  join stores s on s.district_id = us.scope_id
  where us.user_id = uid and us.scope_type = 'district'
  union
  select s.id from user_scopes us
  join districts d on d.area_id = us.scope_id
  join stores s on s.district_id = d.id
  where us.user_id = uid and us.scope_type = 'area'
  union
  select s.id from user_scopes us
  join areas a on a.region_id = us.scope_id
  join districts d on d.area_id = a.id
  join stores s on s.district_id = d.id
  where us.user_id = uid and us.scope_type = 'region'
  union
  select s.id from stores s where exists (
    select 1 from user_scopes us
    where us.user_id = uid and us.scope_type = 'global'
  )
  union
  select s.id from profiles p
  join stores s on s.id = p.primary_store_id
  where p.id = uid and p.primary_store_id is not null and s.is_active;
$$;
