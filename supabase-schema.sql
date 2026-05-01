-- =============================================================================
-- SOAR Hub Database Schema
-- =============================================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- =============================================================================
-- ENUMS
-- =============================================================================

-- Roles ordered lowest → highest privilege (supports >= comparisons)
create type user_role as enum (
  'employee',
  'store_manager',
  'district_manager',
  'market_director',
  'regional_director',
  'admin',
  'super_admin'
);

create type module_status as enum ('active', 'inactive');

-- =============================================================================
-- TABLES
-- =============================================================================

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

create table districts (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  code        text        not null unique,
  market_id   uuid        not null references markets(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table stores (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  number      text        not null unique,
  district_id uuid        not null references districts(id) on delete cascade,
  address     text,
  city        text,
  state       text,
  zip         text,
  phone       text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table users (
  id                    uuid        primary key references auth.users(id) on delete cascade,
  email                 text        not null unique,
  username              text        not null unique,
  full_name             text        not null,
  role                  user_role   not null default 'employee',
  pin_hash              text        not null,
  force_password_change boolean     not null default false,
  last_login            timestamptz,
  phone                 text,
  region_id             uuid        references regions(id)   on delete set null,
  market_id             uuid        references markets(id)   on delete set null,
  district_id           uuid        references districts(id) on delete set null,
  store_id              uuid        references stores(id)    on delete set null,
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table modules (
  id          uuid          primary key default uuid_generate_v4(),
  key         text          not null unique,
  name        text          not null,
  description text,
  icon        text,
  status      module_status not null default 'active',
  min_role    user_role     not null default 'employee',
  sort_order  integer       not null default 0,
  group_name  text          not null,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);

-- Per-role overrides: can enable/disable a module for a specific role,
-- overriding the default min_role threshold on the module itself.
create table module_access (
  id          uuid        primary key default uuid_generate_v4(),
  module_id   uuid        not null references modules(id) on delete cascade,
  role        user_role   not null,
  is_enabled  boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (module_id, role)
);

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================

create or replace function trigger_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on regions
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on markets
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on districts
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on stores
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on users
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on modules
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on module_access
  for each row execute function trigger_set_updated_at();

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Returns the role of the currently authenticated user.
create or replace function current_user_role()
returns user_role language sql security definer stable as $$
  select role from users where id = auth.uid();
$$;

-- Returns true if the current user's role is >= required_role.
-- Enum order (lowest→highest) makes >= comparisons work correctly.
create or replace function has_min_role(required_role user_role)
returns boolean language sql security definer stable as $$
  select coalesce(
    (select role >= required_role from users where id = auth.uid()),
    false
  );
$$;

-- Returns true if current user is admin or super_admin.
create or replace function is_admin()
returns boolean language sql security definer stable as $$
  select has_min_role('admin');
$$;

-- Auto-provision a users row when a new auth.users record is created.
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into users (id, email, username, full_name, pin_hash)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'pin_hash', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table regions       enable row level security;
alter table markets       enable row level security;
alter table districts     enable row level security;
alter table stores        enable row level security;
alter table users         enable row level security;
alter table modules       enable row level security;
alter table module_access enable row level security;

-- ---------------------------------------------------------------------------
-- regions
-- ---------------------------------------------------------------------------
create policy "regions: authenticated read"
  on regions for select
  to authenticated
  using (true);

create policy "regions: admin write"
  on regions for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- markets
-- ---------------------------------------------------------------------------
create policy "markets: authenticated read"
  on markets for select
  to authenticated
  using (true);

create policy "markets: admin write"
  on markets for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- districts
-- ---------------------------------------------------------------------------
create policy "districts: authenticated read"
  on districts for select
  to authenticated
  using (true);

create policy "districts: admin write"
  on districts for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- stores
-- ---------------------------------------------------------------------------
create policy "stores: authenticated read"
  on stores for select
  to authenticated
  using (true);

create policy "stores: admin write"
  on stores for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

-- Users can always read their own row.
create policy "users: read own"
  on users for select
  to authenticated
  using (id = auth.uid());

-- Admins can read all users.
create policy "users: admin read all"
  on users for select
  to authenticated
  using (is_admin());

-- District managers and above can read users in their scope.
create policy "users: manager read scoped"
  on users for select
  to authenticated
  using (
    has_min_role('district_manager') and (
      store_id    in (select id from stores    where district_id = (select district_id from users where id = auth.uid())) or
      district_id = (select district_id from users where id = auth.uid()) or
      market_id   = (select market_id   from users where id = auth.uid()) or
      region_id   = (select region_id   from users where id = auth.uid())
    )
  );

-- Users can update their own non-privileged fields.
create policy "users: update own"
  on users for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid() and
    -- Prevent self-promotion: new role must equal current role unless admin
    (role = (select role from users where id = auth.uid()) or is_admin())
  );

-- Only admins can insert or delete user rows (beyond the auto-provision trigger).
create policy "users: admin insert"
  on users for insert
  to authenticated
  with check (is_admin());

create policy "users: admin delete"
  on users for delete
  to authenticated
  using (is_admin());

create policy "users: admin update"
  on users for update
  to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- modules
-- ---------------------------------------------------------------------------
create policy "modules: read active"
  on modules for select
  to authenticated
  using (
    status = 'active' and has_min_role(min_role)
  );

create policy "modules: admin read all"
  on modules for select
  to authenticated
  using (is_admin());

create policy "modules: admin write"
  on modules for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- module_access
-- ---------------------------------------------------------------------------
create policy "module_access: authenticated read"
  on module_access for select
  to authenticated
  using (true);

create policy "module_access: admin write"
  on module_access for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- =============================================================================
-- INDEXES
-- =============================================================================

create index on markets       (region_id);
create index on districts     (market_id);
create index on stores        (district_id);
create index on users         (role);
create index on users         (store_id);
create index on users         (district_id);
create index on users         (market_id);
create index on users         (region_id);
create index on modules       (status, min_role);
create index on modules       (group_name, sort_order);
create index on module_access (module_id, role);

-- =============================================================================
-- SEED: MODULES
-- =============================================================================

insert into modules (key, name, description, icon, status, min_role, sort_order, group_name) values

  -- Operations
  ('work_orders',     'Work Orders',     'Create and manage maintenance and repair work orders',        'wrench',           'active', 'store_manager',    10, 'Operations'),
  ('cash_management', 'Cash Management', 'Track cash handling, deposits, and safe counts',              'banknote',         'active', 'store_manager',    20, 'Operations'),
  ('paf',             'PAF',             'Personnel action forms and HR workflow submissions',          'file-text',        'active', 'store_manager',    30, 'Operations'),
  ('facilities_v2',   'Facilities',      'Facilities management, inspections, and maintenance logs',   'building-2',       'active', 'store_manager',    40, 'Operations'),

  -- People
  ('my_team',         'My Team',         'View and manage your direct team members and schedules',     'users',            'active', 'store_manager',    50, 'People'),

  -- Performance
  ('ranker',          'Ranker',          'Store and district performance rankings and comparisons',    'trophy',           'active', 'district_manager', 60, 'Performance'),
  ('do_dashboard',    'DO Dashboard',    'District operator KPI dashboard and scorecard',             'layout-dashboard', 'active', 'district_manager', 70, 'Performance'),
  ('pl_review',       'P&L Review',      'Profit and loss statements, review, and variance analysis', 'trending-up',      'active', 'district_manager', 80, 'Performance'),

  -- Resources
  ('resources',       'Resources',       'Company documents, training materials, and guides',         'book-open',        'active', 'employee',         90, 'Resources'),
  ('who_to_call',     'Who To Call',     'Contact directory for support, vendors, and escalations',   'phone',            'active', 'employee',        100, 'Resources'),

  -- System
  ('admin',           'Admin',           'User management, permissions, and system configuration',    'shield',           'active', 'admin',           110, 'System'),
  ('analytics',       'Analytics',       'Advanced cross-region analytics and custom reporting',      'bar-chart-2',      'active', 'regional_director',120, 'System');
