-- supabase/migrations/0031_extend_contact_tiers.sql
--
-- Per planning feedback: contacts (and vendors) need full five-tier
-- scoping — Company, Regional, Area, District, Store — so that DOs
-- can write a contact that applies to all stores in their district,
-- SDOs can write at area-wide, RVPs at region-wide.
--
-- Approach: rebuild tier_type as a new enum that includes 'area' and
-- 'district' (ALTER TYPE ADD VALUE can't be combined with check-
-- constraint updates in the same transaction, so a swap is cleaner).
-- Add area_id + district_id FK columns to contacts and vendors. Update
-- the polymorphic-scope check constraint to enforce exactly one of
-- region_id / area_id / district_id / store_id set per tier. Add
-- visibility helpers for areas + districts. Drop and recreate RLS
-- policies to cover all five tiers.
--
-- Backward-compatible for existing rows: 'company', 'regional', and
-- 'store' values flow through unchanged. No data migration required.
--
-- Idempotent. Apply via the Supabase SQL editor against Soar Hub v2.

-- ============================================================
-- Rebuild tier_type with the two new values
-- ============================================================

do $$
begin
  -- Only rebuild if 'area' isn't already in the enum (idempotency).
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'tier_type' and e.enumlabel = 'area'
  ) then
    create type tier_type_new as enum ('company', 'regional', 'area', 'district', 'store');
    alter table contacts alter column tier type tier_type_new
      using tier::text::tier_type_new;
    alter table vendors  alter column tier type tier_type_new
      using tier::text::tier_type_new;
    drop type tier_type;
    alter type tier_type_new rename to tier_type;
  end if;
end $$;

-- ============================================================
-- Add area_id + district_id FK columns
-- ============================================================

alter table contacts
  add column if not exists area_id     uuid references areas(id)     on delete cascade,
  add column if not exists district_id uuid references districts(id) on delete cascade;

alter table vendors
  add column if not exists area_id     uuid references areas(id)     on delete cascade,
  add column if not exists district_id uuid references districts(id) on delete cascade;

-- ============================================================
-- Polymorphic-scope check constraints — drop + recreate to cover
-- the new tiers. Exactly one of region_id / area_id / district_id /
-- store_id is set, depending on tier; all null for company.
-- ============================================================

alter table contacts drop constraint if exists contacts_tier_scope_ck;
alter table contacts add constraint contacts_tier_scope_ck check (
  (tier = 'company'
    and region_id is null and area_id is null and district_id is null and store_id is null)
  or (tier = 'regional'
    and region_id is not null and area_id is null and district_id is null and store_id is null)
  or (tier = 'area'
    and area_id is not null and region_id is null and district_id is null and store_id is null)
  or (tier = 'district'
    and district_id is not null and region_id is null and area_id is null and store_id is null)
  or (tier = 'store'
    and store_id is not null and region_id is null and area_id is null and district_id is null)
);

alter table vendors drop constraint if exists vendors_tier_scope_ck;
alter table vendors add constraint vendors_tier_scope_ck check (
  (tier = 'company'
    and region_id is null and area_id is null and district_id is null and store_id is null)
  or (tier = 'regional'
    and region_id is not null and area_id is null and district_id is null and store_id is null)
  or (tier = 'area'
    and area_id is not null and region_id is null and district_id is null and store_id is null)
  or (tier = 'district'
    and district_id is not null and region_id is null and area_id is null and store_id is null)
  or (tier = 'store'
    and store_id is not null and region_id is null and area_id is null and district_id is null)
);

-- Index for the new tier+scope lookups.
create index if not exists contacts_area_id_idx
  on contacts(area_id) where area_id is not null;
create index if not exists contacts_district_id_idx
  on contacts(district_id) where district_id is not null;
create index if not exists vendors_area_id_idx
  on vendors(area_id) where area_id is not null;
create index if not exists vendors_district_id_idx
  on vendors(district_id) where district_id is not null;

-- ============================================================
-- Visibility helpers for areas + districts
-- ============================================================

create or replace function user_visible_areas(uid uuid)
returns setof uuid
language sql stable as $$
  select distinct d.area_id
  from stores s
  join districts d on d.id = s.district_id
  where s.id in (select user_visible_stores(uid));
$$;

create or replace function user_visible_districts(uid uuid)
returns setof uuid
language sql stable as $$
  select distinct s.district_id
  from stores s
  where s.id in (select user_visible_stores(uid));
$$;

-- ============================================================
-- Rebuild RLS policies on contacts + vendors to cover all 5 tiers
-- ============================================================

-- Drop existing policies — they reference the old tier set without
-- area/district handling, and we want a clean slate.
drop policy if exists contacts_select on contacts;
drop policy if exists contacts_insert on contacts;
drop policy if exists contacts_update on contacts;
drop policy if exists contacts_delete on contacts;
drop policy if exists vendors_select on vendors;
drop policy if exists vendors_insert on vendors;
drop policy if exists vendors_update on vendors;
drop policy if exists vendors_delete on vendors;

-- CONTACTS
create policy contacts_select on contacts for select using (
  is_admin()
  or tier = 'company'
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and not (user_primary_store(auth.uid()) = any(hidden_for_store_ids)))
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and not (user_primary_store(auth.uid()) = any(hidden_for_store_ids)))
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and not (user_primary_store(auth.uid()) = any(hidden_for_store_ids)))
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
);

create policy contacts_insert on contacts for insert with check (
  is_admin()
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
);

create policy contacts_update on contacts for update
using (
  is_admin()
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
)
with check (
  is_admin()
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
);

create policy contacts_delete on contacts for delete using (
  is_admin()
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
);

-- VENDORS — same shape as contacts; vendors don't carry the
-- hidden_for_store_ids opt-out (only contacts do).
create policy vendors_select on vendors for select using (
  is_admin()
  or tier = 'company'
  or (tier = 'regional' and region_id   in (select user_visible_regions(auth.uid())))
  or (tier = 'area'     and area_id     in (select user_visible_areas(auth.uid())))
  or (tier = 'district' and district_id in (select user_visible_districts(auth.uid())))
  or (tier = 'store'    and store_id    in (select user_visible_stores(auth.uid())))
);

create policy vendors_insert on vendors for insert with check (
  is_admin()
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
);

create policy vendors_update on vendors for update
using (
  is_admin()
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
)
with check (
  is_admin()
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
);

create policy vendors_delete on vendors for delete using (
  is_admin()
  or (tier = 'regional'
      and region_id in (select user_visible_regions(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'area'
      and area_id in (select user_visible_areas(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'district'
      and district_id in (select user_visible_districts(auth.uid()))
      and user_has_leadership_reach())
  or (tier = 'store'
      and store_id in (select user_visible_stores(auth.uid())))
);

notify pgrst, 'reload schema';
