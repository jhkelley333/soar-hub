-- supabase/migrations/0009_rename_markets_to_areas.sql
--
-- Phase 2c: rename `markets` -> `areas` everywhere in the schema so SQL
-- terminology matches what the business actually calls them. The Org Admin
-- tree view is the first surface to display these labels prominently and
-- "market" was already a translation step we made every conversation.
--
-- WHAT'S RENAMED:
--   enum scope_type: value 'market'        -> 'area'
--   table  markets                         -> areas
--   column districts.market_id             -> area_id
--   index  markets_region_id_idx           -> areas_region_id_idx
--   index  districts_market_id_idx         -> districts_area_id_idx
--   index  markets_is_active_idx           -> areas_is_active_idx     (from 0007)
--   trigger markets_set_updated_at         -> areas_set_updated_at
--
-- WHAT'S RECREATED (because the body references `markets` / `market_id`):
--   function user_visible_stores(uuid)
--   policy   regions_select       (RLS on regions)
--   policy   markets_select       -> areas_select
--   policy   markets_admin_write  -> areas_admin_write
--   policy   districts_select     (RLS on districts)
--
-- NOT TOUCHED:
--   org_target_kind enum value 'market' (0008) — left as-is on purpose:
--   audit history pre-rename uses 'market' literal, post-rename writes use
--   the new value. Adding 'area' to the enum keeps the historical label
--   readable. Done at the bottom of this migration.
--
-- SAFETY:
--   - ALTER TYPE ... RENAME VALUE is single-statement and requires PG10+.
--   - Renaming a table preserves OIDs, FKs, indexes, and existing data.
--   - Drop+recreate of policies/functions runs in one transaction so there
--     is no window where the table is unprotected.
--   - Idempotent: each step checks pg_catalog before acting.

-- 1. Enum value rename ------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_enum
    where enumtypid = 'scope_type'::regtype and enumlabel = 'market'
  ) then
    alter type scope_type rename value 'market' to 'area';
  end if;
end$$;

-- 2. Table + column renames -------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class where relname = 'markets' and relkind = 'r') then
    alter table markets rename to areas;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'districts' and column_name = 'market_id'
  ) then
    alter table districts rename column market_id to area_id;
  end if;
end$$;

-- 3. Index + trigger renames ------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class where relname = 'markets_region_id_idx') then
    alter index markets_region_id_idx rename to areas_region_id_idx;
  end if;
  if exists (select 1 from pg_class where relname = 'districts_market_id_idx') then
    alter index districts_market_id_idx rename to districts_area_id_idx;
  end if;
  if exists (select 1 from pg_class where relname = 'markets_is_active_idx') then
    alter index markets_is_active_idx rename to areas_is_active_idx;
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname = 'markets_set_updated_at'
  ) then
    alter trigger markets_set_updated_at on areas rename to areas_set_updated_at;
  end if;
end$$;

-- 4. Recreate user_visible_stores with new identifiers ----------------------
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
  );
$$;

-- 5. Drop + recreate affected RLS policies ----------------------------------
-- regions_select references markets by name in its EXISTS subqueries.
drop policy if exists regions_select on regions;
create policy regions_select on regions for select
  using (
    is_admin() or is_payroll() or
    exists (
      select 1 from user_scopes us
      where us.user_id = auth.uid()
        and (
          (us.scope_type = 'global') or
          (us.scope_type = 'region' and us.scope_id = regions.id) or
          (us.scope_type = 'area' and exists (
            select 1 from areas a where a.id = us.scope_id and a.region_id = regions.id
          )) or
          (us.scope_type = 'district' and exists (
            select 1 from districts d
            join areas a on a.id = d.area_id
            where d.id = us.scope_id and a.region_id = regions.id
          )) or
          (us.scope_type = 'store' and exists (
            select 1 from stores s
            join districts d on d.id = s.district_id
            join areas a on a.id = d.area_id
            where s.id = us.scope_id and a.region_id = regions.id
          ))
        )
    )
  );

-- old markets_select / markets_admin_write replaced by areas_* equivalents.
drop policy if exists markets_select      on areas;
drop policy if exists markets_admin_write on areas;

create policy areas_select on areas for select
  using (
    is_admin() or is_payroll() or
    exists (
      select 1 from user_scopes us
      where us.user_id = auth.uid()
        and (
          (us.scope_type = 'global') or
          (us.scope_type = 'region' and us.scope_id = areas.region_id) or
          (us.scope_type = 'area' and us.scope_id = areas.id) or
          (us.scope_type = 'district' and exists (
            select 1 from districts d where d.id = us.scope_id and d.area_id = areas.id
          )) or
          (us.scope_type = 'store' and exists (
            select 1 from stores s
            join districts d on d.id = s.district_id
            where s.id = us.scope_id and d.area_id = areas.id
          ))
        )
    )
  );
create policy areas_admin_write on areas for all
  using (is_admin()) with check (is_admin());

-- districts_select references market_id; needs the new column name.
drop policy if exists districts_select on districts;
create policy districts_select on districts for select
  using (
    is_admin() or is_payroll() or
    exists (
      select 1 from user_scopes us
      where us.user_id = auth.uid()
        and (
          (us.scope_type = 'global') or
          (us.scope_type = 'region' and exists (
            select 1 from areas a where a.id = districts.area_id and a.region_id = us.scope_id
          )) or
          (us.scope_type = 'area' and us.scope_id = districts.area_id) or
          (us.scope_type = 'district' and us.scope_id = districts.id) or
          (us.scope_type = 'store' and exists (
            select 1 from stores s where s.id = us.scope_id and s.district_id = districts.id
          ))
        )
    )
  );

-- 6. Add 'area' to the org_changes target_kind enum -------------------------
-- Pre-existing audit rows (if any) keep the literal 'market' value so the
-- history reads true. New writes use 'area'.
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'org_target_kind'::regtype and enumlabel = 'area'
  ) then
    alter type org_target_kind add value 'area' after 'region';
  end if;
end$$;
