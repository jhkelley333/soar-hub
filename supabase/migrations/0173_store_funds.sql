-- 0173_store_funds.sql
-- SOAR Cash Management — Store Funds (the "Bank") validation.
-- DOs count each store's on-hand cash Bank in week 1 of every 4-week period and
-- reconcile it to the assigned Bank amount. Over the tolerance ($5) escalates to
-- the SDO. (We call it the "Bank", never "float".)

-- Per-store assigned Bank amount. Seeded/maintained by an admin; a store with no
-- row simply hasn't had its Bank set yet.
create table if not exists store_fund_settings (
  store_id          uuid primary key references stores(id) on delete cascade,
  store_number      text not null,
  bank_amount_cents integer not null default 0,
  updated_by        uuid references profiles(id) on delete set null,
  updated_by_name   text,
  updated_at        timestamptz not null default now()
);

-- One row per DO validation/count. fiscal_period/week_in_period are stamped at
-- count time (FY2026 4-4-5, mirrors src/lib/fiscal.ts) so the month-to-month
-- metrics group without re-deriving the calendar.
create table if not exists store_fund_validations (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references stores(id) on delete cascade,
  store_number      text not null,
  business_date     date not null,
  fiscal_period     integer,
  fiscal_week       integer,
  week_in_period    integer,
  bank_amount_cents integer not null,
  counted_cents     integer not null,
  variance_cents    integer not null,
  denominations     jsonb,
  over_tolerance    boolean not null default false,
  reason            text,
  validated_by      uuid references profiles(id) on delete set null,
  validated_by_name text,
  validated_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists store_fund_validations_store_idx on store_fund_validations (store_id, validated_at desc);
create index if not exists store_fund_validations_period_idx on store_fund_validations (fiscal_period);

-- Tolerance lives with the other cash tolerances (global, admin-configurable).
alter table cash_settings
  add column if not exists fund_tolerance_cents integer not null default 500;

-- Service-role only (the cash-management function uses the service key); RLS on
-- with no policies, consistent with the other cash tables.
alter table store_fund_settings enable row level security;
alter table store_fund_validations enable row level security;

notify pgrst, 'reload schema';
