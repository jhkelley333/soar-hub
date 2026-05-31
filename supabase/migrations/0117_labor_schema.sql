-- supabase/migrations/0117_labor_schema.sql
--
-- Labor module — data foundation.
--
-- Two tables, same facts-vs-workflow split as the rest of the app:
--
--   labor_daily_snapshots  Immutable nightly snapshot of the "Labor" tab
--                          of the SOAR labor Google Sheet. One row per
--                          (store, business_date). The sheet is a single-
--                          day overwrite view that carries Daily + WTD +
--                          PTD side by side, so each snapshot row captures
--                          all three bands for that store's sales date.
--                          History accrues forward from go-live (the sheet
--                          keeps no daily archive, so it cannot be
--                          backfilled). Written by the nightly
--                          netlify/functions/labor-snapshot.js job.
--
--   labor_reviews          The GM's daily review of their labor: a note +
--                          acknowledgment per (store, business_date). The
--                          human layer on top of the facts; DOs roll these
--                          up (visibility + the "who hasn't reviewed" list).
--
-- Percentages are stored as the percent number shown on the sheet
-- (e.g. 34.44 for "34.44%"), dollars/hours as their plain numeric value.
--
-- RLS: enabled with NO policies — every read/write goes through a Netlify
-- function using the service-role key, which enforces scope in code via
-- user_visible_stores() (mirrors paf_submissions 0016 / employee_actions
-- 0089). Wages/labor must never leak across scope.
--
-- Idempotent.

-- ----------------------------------------------------------------------------
-- Daily snapshot (facts)
-- ----------------------------------------------------------------------------
create table if not exists labor_daily_snapshots (
  id                       uuid        primary key default uuid_generate_v4(),

  store_id                 uuid        not null references stores(id) on delete cascade,
  store_number             text        not null,         -- DI as seen on the sheet
  business_date            date        not null,         -- the sheet's "Sales Date"

  -- As-of org labels copied from the sheet row (display/audit only; live
  -- scope always comes from the app's org, never these strings).
  location_name            text,
  gm_name                  text,
  do_name                  text,
  sdo_name                 text,
  rvp_name                 text,

  -- Daily band
  daily_labor_pct          numeric(8,2),
  daily_sales              numeric(14,2),
  daily_variance_to_chart  numeric(8,2),
  daily_dollars_over_chart numeric(14,2),
  daily_hours_over_chart   numeric(10,2),

  -- Week to Date band
  wtd_labor_pct            numeric(8,2),
  wtd_sales                numeric(14,2),
  wtd_variance_to_chart    numeric(8,2),
  wtd_dollars_over_chart   numeric(14,2),
  wtd_hours_over_chart     numeric(10,2),

  -- Period to Date band
  ptd_labor_pct            numeric(8,2),
  ptd_sales                numeric(14,2),
  ptd_variance_to_chart    numeric(8,2),
  ptd_dollars_over_chart   numeric(14,2),
  ptd_hours_over_chart     numeric(10,2),

  base_ptd_labor_goal      numeric(8,2),

  raw                      jsonb,                          -- original parsed row, for audit/debug
  source_synced_at         timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (store_id, business_date)
);

create index if not exists labor_daily_snapshots_date_idx
  on labor_daily_snapshots (business_date);
create index if not exists labor_daily_snapshots_store_idx
  on labor_daily_snapshots (store_id);
create index if not exists labor_daily_snapshots_store_number_idx
  on labor_daily_snapshots (store_number);

-- ----------------------------------------------------------------------------
-- Daily review (workflow)
-- ----------------------------------------------------------------------------
create table if not exists labor_reviews (
  id               uuid        primary key default uuid_generate_v4(),

  store_id         uuid        not null references stores(id) on delete cascade,
  store_number     text        not null,
  business_date    date        not null,

  reviewed_by_id   uuid        references profiles(id) on delete set null,
  reviewed_by_email text,
  note             text,
  acknowledged     boolean     not null default true,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (store_id, business_date)
);

create index if not exists labor_reviews_date_idx
  on labor_reviews (business_date);
create index if not exists labor_reviews_store_idx
  on labor_reviews (store_id);

-- ----------------------------------------------------------------------------
-- updated_at triggers (reuse the set_updated_at() helper from 0001_init.sql).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'labor_daily_snapshots_set_updated_at'
  ) then
    create trigger labor_daily_snapshots_set_updated_at
      before update on labor_daily_snapshots
      for each row execute function set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'labor_reviews_set_updated_at'
  ) then
    create trigger labor_reviews_set_updated_at
      before update on labor_reviews
      for each row execute function set_updated_at();
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- RLS: lock both tables; access is service-role only (scope enforced in
-- the Netlify functions, mirroring employee_actions / paf_submissions).
-- ----------------------------------------------------------------------------
alter table labor_daily_snapshots enable row level security;
alter table labor_reviews         enable row level security;
-- (No policies — service role bypasses RLS; anon/auth get nothing.)
