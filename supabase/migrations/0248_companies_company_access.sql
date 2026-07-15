-- 0248_companies_company_access.sql
-- Cross-brand foundation for the COO map. Adds a companies table + a per-user
-- company_access grant table, and brand / company_id / brand_meta on stores.
-- Relaxes stores so Apricus (Little Caesars) stores — which carry no SOAR
-- Region/Area/District — can live in the same table: district_id becomes
-- nullable and store numbers are unique PER COMPANY rather than globally.
-- The existing stores SELECT policy is intentionally left untouched; the COO
-- map reads cross-company through a dedicated RPC (Phase 4).

-- ── companies ────────────────────────────────────────────────────────
create table if not exists companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  created_at timestamptz not null default now()
);

insert into companies (name, slug) values
  ('SOAR QSR', 'soar'),
  ('Apricus QSR', 'apricus')
on conflict (slug) do nothing;

-- ── company_access: which users may see which companies on the COO map ─
create table if not exists company_access (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

-- ── brand + company + per-brand metadata on stores ───────────────────
alter table stores
  add column if not exists brand      text  not null default 'sonic',
  add column if not exists company_id uuid  references companies(id),
  add column if not exists brand_meta jsonb not null default '{}'::jsonb;

-- Backfill existing rows — every current store is SOAR Sonic.
update stores
  set company_id = (select id from companies where slug = 'soar')
  where company_id is null;

-- Apricus stores have no SOAR hierarchy: allow a null district.
alter table stores alter column district_id drop not null;

-- Store numbers are unique PER COMPANY, not globally. Drop the original
-- global UNIQUE(number) (whatever it's named) and add the composite one.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.stores'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (number)';
  if c is not null then execute format('alter table stores drop constraint %I', c); end if;
end $$;
create unique index if not exists stores_company_number_key on stores (company_id, number);

-- ── RLS (same migration as the tables) ───────────────────────────────
alter table companies      enable row level security;
alter table company_access enable row level security;

-- A user reads only their own grants.
drop policy if exists "read own company_access" on company_access;
create policy "read own company_access"
  on company_access for select
  using (user_id = auth.uid());

-- A user reads only companies they've been granted.
drop policy if exists "read granted companies" on companies;
create policy "read granted companies"
  on companies for select
  using (id in (select company_id from company_access where user_id = auth.uid()));

notify pgrst, 'reload schema';
