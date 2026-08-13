-- 0288_acquisitions.sql
-- Acquisition staging: hold an upcoming deal's stores (and their intended org
-- placement + GM) OUTSIDE the live tables until go-live, then merge them in as
-- active stores in one action. Nothing here touches stores/org until merge, so
-- staged data never leaks into the hub. Service-role gatekeeper: RLS on, no
-- policies; the acquisitions function enforces admin/vp/coo.

create table if not exists acquisitions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  close_date  date,
  status      text not null default 'draft' check (status in ('draft', 'merged')),
  notes       text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  merged_at   timestamptz,
  merged_by   uuid references profiles(id) on delete set null
);

create table if not exists acquisition_stores (
  id              uuid primary key default gen_random_uuid(),
  acquisition_id  uuid not null references acquisitions(id) on delete cascade,
  store_number    text not null,
  name            text,
  address         text,
  city            text,
  state           text,
  zip             text,
  phone           text,
  region_name     text,
  area_name       text,
  district_name   text,
  gm_name         text,
  gm_email        text,
  gm_phone        text,
  notes           text,
  -- set when this staged store has been merged into the live stores table
  merged_store_id uuid references stores(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists acquisition_stores_acq_idx on acquisition_stores (acquisition_id);

alter table acquisitions enable row level security;
alter table acquisition_stores enable row level security;

notify pgrst, 'reload schema';
