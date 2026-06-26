-- 0188_labor_v2_closes.sql
-- Closed fiscal-week and fiscal-period labor snapshots for Labor v2. When the
-- feed's business_date is a fiscal week end (Sunday), each store's final WTD is
-- written to labor_v2_week_close; on a fiscal period end, the final PTD goes to
-- labor_v2_period_close. Keyed by fiscal identifiers so each closed week/period
-- is one row per store (upsert → latest revision wins). Service-only: RLS on,
-- no policies. Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

create table if not exists labor_v2_week_close (
  store_number      text        not null,
  fiscal_year       text        not null,   -- e.g. 'FY2026'
  fiscal_week       int         not null,   -- 1..52 within the fiscal year
  period            int,                     -- the period this week belongs to
  week_in_period    int,                     -- 1..5
  week_start        date,
  week_end          date,                    -- the closing Sunday
  business_date     date,                    -- date the close was captured from
  net_sales         numeric,
  labor_cost        numeric,
  labor_hours       numeric,
  labor_pct         numeric,                 -- fraction
  target_labor_pct  numeric,                 -- fraction
  captured_at       timestamptz not null default now(),
  primary key (store_number, fiscal_year, fiscal_week)
);
create index if not exists labor_v2_week_close_fy_idx on labor_v2_week_close (fiscal_year, fiscal_week);

create table if not exists labor_v2_period_close (
  store_number      text        not null,
  fiscal_year       text        not null,
  period            int         not null,   -- 1..12
  quarter           int,
  period_start      date,
  period_end        date,                    -- the closing Sunday
  business_date     date,
  net_sales         numeric,
  labor_cost        numeric,
  labor_hours       numeric,
  labor_pct         numeric,                 -- fraction
  target_labor_pct  numeric,                 -- fraction
  captured_at       timestamptz not null default now(),
  primary key (store_number, fiscal_year, period)
);
create index if not exists labor_v2_period_close_fy_idx on labor_v2_period_close (fiscal_year, period);

alter table labor_v2_week_close   enable row level security;
alter table labor_v2_period_close enable row level security;
-- No policies → client roles denied; service role (functions) bypasses RLS.

notify pgrst, 'reload schema';
