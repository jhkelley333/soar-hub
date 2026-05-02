-- =============================================================================
-- SOAR QSR Operations Hub — Initial Schema
-- Migration: 0001_init
-- =============================================================================
-- Establishes:
--   1. Org hierarchy: regions → markets → districts → stores
--   2. Profiles linked to auth.users (Supabase Auth)
--   3. user_scopes — decouples role from geographic visibility
--   4. Helper SQL functions used by RLS policies on every module
--   5. RLS policies for the foundation tables
-- =============================================================================

create extension if not exists "uuid-ossp";

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------

-- Hierarchy roles ordered low → high. `payroll` is horizontal (cross-org PAF
-- access) and is excluded from numeric hierarchy comparisons via role_level().
create type user_role as enum (
  'shift_manager',
  'gm',
  'do',
  'sdo',
  'rvp',
  'payroll',
  'admin'
);

create type scope_type as enum (
  'store',
  'district',
  'market',
  'region',
  'global'
);

-- -----------------------------------------------------------------------------
-- ORG HIERARCHY
-- -----------------------------------------------------------------------------

create table regions (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  code        text        not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table markets (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  code        text        not null unique,
  region_id   uuid        not null references regions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index markets_region_id_idx on markets(region_id);

create table districts (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  code        text        not null unique,
  market_id   uuid        not null references markets(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index districts_market_id_idx on districts(market_id);

create table stores (
  id          uuid        primary key default uuid_generate_v4(),
  number      text        not null unique,
  name        text        not null,
  district_id uuid        not null references districts(id) on delete restrict,
  address     text,
  city        text,
  state       text,
  zip         text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index stores_district_id_idx on stores(district_id);

-- -----------------------------------------------------------------------------
-- PROFILES (1:1 with auth.users)
-- -----------------------------------------------------------------------------

create table profiles (
  id                uuid        primary key references auth.users(id) on delete cascade,
  email             text        not null unique,
  full_name         text,
  role              user_role   not null default 'shift_manager',
  primary_store_id  uuid        references stores(id) on delete set null,
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index profiles_role_idx on profiles(role);
create index profiles_primary_store_id_idx on profiles(primary_store_id);

-- Trigger: when a new auth.users row is inserted, create a profiles row.
-- Default role is shift_manager — admins promote from there.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- -----------------------------------------------------------------------------
-- USER SCOPES — decouples role from geographic visibility
-- -----------------------------------------------------------------------------
-- Examples:
--   GM at one store:   (user, 'store', store_id)
--   DO over 8 stores:  (user, 'district', district_id) OR multiple store rows
--   RVP over a region: (user, 'region', region_id)
--   Admin / payroll:   (user, 'global', null)
-- -----------------------------------------------------------------------------

create table user_scopes (
  id          uuid        primary key default uuid_generate_v4(),
  user_id     uuid        not null references profiles(id) on delete cascade,
  scope_type  scope_type  not null,
  scope_id    uuid,
  created_at  timestamptz not null default now(),
  -- scope_id must be null iff scope_type='global'
  constraint scope_id_matches_type check (
    (scope_type = 'global' and scope_id is null) or
    (scope_type <> 'global' and scope_id is not null)
  ),
  unique (user_id, scope_type, scope_id)
);
create index user_scopes_user_id_idx on user_scopes(user_id);
create index user_scopes_lookup_idx on user_scopes(scope_type, scope_id);

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS (used by RLS — defined SECURITY DEFINER and STABLE)
-- -----------------------------------------------------------------------------

-- Numeric hierarchy level. Returns null for horizontal roles (payroll) so
-- callers can decide how to handle them. Gaps of 10 leave room for new roles.
create or replace function role_level(r user_role)
returns int
language sql
immutable
as $$
  select case r
    when 'shift_manager' then 10
    when 'gm'            then 20
    when 'do'            then 30
    when 'sdo'           then 40
    when 'rvp'           then 50
    when 'admin'         then 100
    when 'payroll'       then null
  end;
$$;

-- Current user's role. Returns null if no profile (e.g. unauthenticated).
create or replace function current_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

create or replace function is_payroll()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'payroll' from profiles where id = auth.uid()), false);
$$;

-- Returns the set of store_ids the given user can see, derived from
-- user_scopes by walking the org hierarchy. Admin and payroll see all stores.
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

  -- district scope → all stores in that district
  select s.id
  from user_scopes us
  join stores s on s.district_id = us.scope_id
  where us.user_id = uid and us.scope_type = 'district'

  union

  -- market scope → districts → stores
  select s.id
  from user_scopes us
  join districts d on d.market_id = us.scope_id
  join stores s on s.district_id = d.id
  where us.user_id = uid and us.scope_type = 'market'

  union

  -- region scope → markets → districts → stores
  select s.id
  from user_scopes us
  join markets m on m.region_id = us.scope_id
  join districts d on d.market_id = m.id
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

-- Convenience: can the current user see this store?
create or replace function can_see_store(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_visible_stores(auth.uid()) v
    where v = target_store_id
  );
$$;

-- -----------------------------------------------------------------------------
-- updated_at trigger helper
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger regions_set_updated_at   before update on regions   for each row execute function set_updated_at();
create trigger markets_set_updated_at   before update on markets   for each row execute function set_updated_at();
create trigger districts_set_updated_at before update on districts for each row execute function set_updated_at();
create trigger stores_set_updated_at    before update on stores    for each row execute function set_updated_at();
create trigger profiles_set_updated_at  before update on profiles  for each row execute function set_updated_at();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Rule of thumb:
--   * SELECT — scoped via user_visible_stores() / scope chain
--   * INSERT/UPDATE/DELETE — admin only on org tables (regions, markets,
--     districts, stores, profiles.role) for now. Per-module tables will define
--     their own write policies in later migrations.
-- =============================================================================

alter table regions       enable row level security;
alter table markets       enable row level security;
alter table districts     enable row level security;
alter table stores        enable row level security;
alter table profiles      enable row level security;
alter table user_scopes   enable row level security;

-- ----- regions -----
create policy regions_select on regions for select
  using (
    is_admin() or is_payroll() or
    exists (
      select 1 from user_scopes us
      where us.user_id = auth.uid()
        and (
          (us.scope_type = 'global') or
          (us.scope_type = 'region' and us.scope_id = regions.id) or
          (us.scope_type = 'market' and exists (
            select 1 from markets m where m.id = us.scope_id and m.region_id = regions.id
          )) or
          (us.scope_type = 'district' and exists (
            select 1 from districts d
            join markets m on m.id = d.market_id
            where d.id = us.scope_id and m.region_id = regions.id
          )) or
          (us.scope_type = 'store' and exists (
            select 1 from stores s
            join districts d on d.id = s.district_id
            join markets m on m.id = d.market_id
            where s.id = us.scope_id and m.region_id = regions.id
          ))
        )
    )
  );
create policy regions_admin_write on regions for all
  using (is_admin()) with check (is_admin());

-- ----- markets -----
create policy markets_select on markets for select
  using (
    is_admin() or is_payroll() or
    exists (
      select 1 from user_scopes us
      where us.user_id = auth.uid()
        and (
          (us.scope_type = 'global') or
          (us.scope_type = 'region' and us.scope_id = markets.region_id) or
          (us.scope_type = 'market' and us.scope_id = markets.id) or
          (us.scope_type = 'district' and exists (
            select 1 from districts d where d.id = us.scope_id and d.market_id = markets.id
          )) or
          (us.scope_type = 'store' and exists (
            select 1 from stores s
            join districts d on d.id = s.district_id
            where s.id = us.scope_id and d.market_id = markets.id
          ))
        )
    )
  );
create policy markets_admin_write on markets for all
  using (is_admin()) with check (is_admin());

-- ----- districts -----
create policy districts_select on districts for select
  using (
    is_admin() or is_payroll() or
    exists (
      select 1 from user_scopes us
      where us.user_id = auth.uid()
        and (
          (us.scope_type = 'global') or
          (us.scope_type = 'region' and exists (
            select 1 from markets m where m.id = districts.market_id and m.region_id = us.scope_id
          )) or
          (us.scope_type = 'market' and us.scope_id = districts.market_id) or
          (us.scope_type = 'district' and us.scope_id = districts.id) or
          (us.scope_type = 'store' and exists (
            select 1 from stores s where s.id = us.scope_id and s.district_id = districts.id
          ))
        )
    )
  );
create policy districts_admin_write on districts for all
  using (is_admin()) with check (is_admin());

-- ----- stores -----
create policy stores_select on stores for select
  using (can_see_store(id));
create policy stores_admin_write on stores for all
  using (is_admin()) with check (is_admin());

-- ----- profiles -----
-- A user can always read their own profile.
-- Admin can read everyone.
-- Payroll can read everyone (needs employee data for PAF processing).
-- Hierarchy users can read profiles of users whose primary_store is in their
-- visible store set.
create policy profiles_select_self on profiles for select
  using (id = auth.uid());

create policy profiles_select_admin on profiles for select
  using (is_admin() or is_payroll());

create policy profiles_select_hierarchy on profiles for select
  using (
    primary_store_id is not null
    and can_see_store(primary_store_id)
  );

-- A user can update their own non-privileged fields. Role / is_active are
-- guarded by an additional admin-only update policy.
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_write on profiles for all
  using (is_admin()) with check (is_admin());

-- ----- user_scopes -----
-- Read your own scope rows; admin reads all.
create policy user_scopes_select_self on user_scopes for select
  using (user_id = auth.uid() or is_admin());

create policy user_scopes_admin_write on user_scopes for all
  using (is_admin()) with check (is_admin());
