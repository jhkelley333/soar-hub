-- supabase/migrations/0029_contacts_and_vendors.sql
--
-- Phase 0 of the Contacts + Vendors refactor (Path B / incremental).
-- Adds the new tables, enums, and audit triggers WITHOUT touching the
-- existing regions/areas/districts/stores hierarchy, profiles.role,
-- user_scopes, or any existing module's RLS.
--
-- New tables:
--   vendors             — first-class vendor records (Phase 0 lives
--                         only behind Contacts; Work Orders rebuild
--                         is a separate later track)
--   vendor_docs         — W-9 / insurance / NDA / certs (storage refs)
--   contacts            — three-tier (company / regional / store)
--                         contact records, optionally bridged to a
--                         vendor via vendor_id
--   contact_audit_log   — per-contact change log (mirrors paf_audit_log
--                         pattern; written by trigger)
--   vendor_audit_log    — same shape for vendors
--
-- Schema additions to existing tables (additive, nullable, no
-- existing-row breakage):
--   stores.pos_system            — 'infor' | 'micros' | null
--   profiles.pinned_contact_ids  — uuid[]
--   profiles.sidebar_order       — jsonb
--
-- RLS policies for the new tables ship in 0030.
-- Storage bucket policies for vendor-docs ship in 0030 too.
--
-- Idempotent. Apply via the Supabase SQL editor against Soar Hub v2.

-- ============================================================
-- Enums
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tier_type') then
    create type tier_type as enum ('company', 'regional', 'store');
  end if;
  if not exists (select 1 from pg_type where typname = 'contact_type_kind') then
    create type contact_type_kind as enum ('person', 'vendor', 'internal_team', 'corporate');
  end if;
end $$;

-- ============================================================
-- Existing-table additions (nullable, safe to backfill)
-- ============================================================

alter table stores
  add column if not exists pos_system text
    check (pos_system in ('infor', 'micros') or pos_system is null);

alter table profiles
  add column if not exists pinned_contact_ids uuid[] not null default '{}',
  add column if not exists sidebar_order jsonb;

-- ============================================================
-- Vendors
-- ============================================================
--
-- Polymorphic scope — explicit FK columns per tier instead of a single
-- scope_id, so Postgres can FK-validate. Exactly one of region_id /
-- store_id is set, depending on tier; both null when tier='company'.

create table if not exists vendors (
  id                  uuid primary key default uuid_generate_v4(),
  company_name        text not null,
  contact_name        text,
  phone               text,
  email               text,
  website             text,
  trade_category      text,
  address             text,
  city                text,
  state               text,
  zip                 text,
  tier                tier_type not null,
  region_id           uuid references regions(id) on delete cascade,
  store_id            uuid references stores(id)  on delete cascade,
  preferred           boolean not null default false,
  hourly_rate         numeric(10,2),
  response_time_hours int,
  w9_on_file          boolean not null default false,
  insurance_expiry    date,
  notes               text,
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint vendors_tier_scope_ck check (
    (tier = 'company'  and region_id is null     and store_id is null) or
    (tier = 'regional' and region_id is not null and store_id is null) or
    (tier = 'store'    and store_id  is not null and region_id is null)
  )
);

create index if not exists vendors_tier_scope_idx
  on vendors(tier, region_id, store_id);
create index if not exists vendors_trade_category_idx
  on vendors(trade_category)
  where trade_category is not null;
create index if not exists vendors_company_name_idx
  on vendors(lower(company_name));

-- ============================================================
-- Vendor docs
-- ============================================================

create table if not exists vendor_docs (
  id            uuid primary key default uuid_generate_v4(),
  vendor_id     uuid not null references vendors(id) on delete cascade,
  doc_type      text not null
    check (doc_type in ('w9', 'insurance', 'nda', 'certification', 'other')),
  storage_path  text not null,  -- key inside the vendor-docs storage bucket
  uploaded_by   uuid references profiles(id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  expires_at    date
);

create index if not exists vendor_docs_vendor_id_idx on vendor_docs(vendor_id);

-- ============================================================
-- Contacts
-- ============================================================

create table if not exists contacts (
  id                    uuid primary key default uuid_generate_v4(),
  display_name          text not null,
  contact_type          contact_type_kind not null default 'person',
  phone                 text,
  extension             text,
  email                 text,
  website               text,
  category              text, -- 'POS' | 'HR' | 'Payroll' | 'Tech' | 'Maintenance' | …
  notes                 text,
  tier                  tier_type not null,
  region_id             uuid references regions(id) on delete cascade,
  store_id              uuid references stores(id)  on delete cascade,
  vendor_id             uuid references vendors(id) on delete set null,
  pos_filter            text
    check (pos_filter in ('infor', 'micros') or pos_filter is null),
  created_by            uuid references profiles(id) on delete set null,
  hidden_for_store_ids  uuid[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint contacts_tier_scope_ck check (
    (tier = 'company'  and region_id is null     and store_id is null) or
    (tier = 'regional' and region_id is not null and store_id is null) or
    (tier = 'store'    and store_id  is not null and region_id is null)
  )
);

create index if not exists contacts_tier_scope_idx
  on contacts(tier, region_id, store_id);
create index if not exists contacts_category_idx
  on contacts(category)
  where category is not null;
create index if not exists contacts_vendor_id_idx
  on contacts(vendor_id)
  where vendor_id is not null;
create index if not exists contacts_pos_filter_idx
  on contacts(pos_filter)
  where pos_filter is not null;

-- ============================================================
-- Audit logs (per-domain, matches paf_audit_log / org_changes pattern)
-- ============================================================

create table if not exists contact_audit_log (
  id          uuid primary key default uuid_generate_v4(),
  contact_id  uuid references contacts(id) on delete set null,
  changed_by  uuid references profiles(id) on delete set null,
  action      text not null
    check (action in ('create', 'update', 'delete', 'hide', 'unhide')),
  changes     jsonb,
  changed_at  timestamptz not null default now()
);

create index if not exists contact_audit_log_contact_id_idx
  on contact_audit_log(contact_id);
create index if not exists contact_audit_log_changed_at_idx
  on contact_audit_log(changed_at desc);

create table if not exists vendor_audit_log (
  id          uuid primary key default uuid_generate_v4(),
  vendor_id   uuid references vendors(id) on delete set null,
  changed_by  uuid references profiles(id) on delete set null,
  action      text not null
    check (action in ('create', 'update', 'delete', 'doc_upload', 'doc_delete')),
  changes     jsonb,
  changed_at  timestamptz not null default now()
);

create index if not exists vendor_audit_log_vendor_id_idx
  on vendor_audit_log(vendor_id);
create index if not exists vendor_audit_log_changed_at_idx
  on vendor_audit_log(changed_at desc);

-- ============================================================
-- updated_at trigger function (shared)
-- ============================================================

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vendors_updated_at on vendors;
create trigger vendors_updated_at
  before update on vendors
  for each row execute function set_updated_at();

drop trigger if exists contacts_updated_at on contacts;
create trigger contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();

-- ============================================================
-- Audit log triggers (security definer so they can write past RLS
-- on the audit log tables, which have no INSERT policies)
-- ============================================================

create or replace function log_contact_change() returns trigger
language plpgsql security definer as $$
declare
  actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into contact_audit_log (contact_id, changed_by, action, changes)
    values (new.id, actor, 'create', to_jsonb(new));
    return new;
  elsif TG_OP = 'UPDATE' then
    -- Note hide/unhide still get logged as 'update' here; if a UI flow
    -- wants the explicit hide/unhide action it'll bypass the trigger
    -- and write the log row itself with that action.
    insert into contact_audit_log (contact_id, changed_by, action, changes)
    values (
      new.id,
      actor,
      'update',
      jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    );
    return new;
  elsif TG_OP = 'DELETE' then
    insert into contact_audit_log (contact_id, changed_by, action, changes)
    values (old.id, actor, 'delete', to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists contacts_audit on contacts;
create trigger contacts_audit
  after insert or update or delete on contacts
  for each row execute function log_contact_change();

create or replace function log_vendor_change() returns trigger
language plpgsql security definer as $$
declare
  actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into vendor_audit_log (vendor_id, changed_by, action, changes)
    values (new.id, actor, 'create', to_jsonb(new));
    return new;
  elsif TG_OP = 'UPDATE' then
    insert into vendor_audit_log (vendor_id, changed_by, action, changes)
    values (
      new.id,
      actor,
      'update',
      jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    );
    return new;
  elsif TG_OP = 'DELETE' then
    insert into vendor_audit_log (vendor_id, changed_by, action, changes)
    values (old.id, actor, 'delete', to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists vendors_audit on vendors;
create trigger vendors_audit
  after insert or update or delete on vendors
  for each row execute function log_vendor_change();

notify pgrst, 'reload schema';
