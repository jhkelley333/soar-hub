-- 0185_labor_v2_daily.sql
-- Per-store, per-day labor + sales history for Labor v2, sourced from the
-- Expressway KPI feed. One row per (store_number, business_date); the scheduled
-- puller and the admin page both upsert, so the latest pull wins and history
-- accrues going forward. Service-only: RLS on, no policies.
-- Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

create table if not exists labor_v2_daily (
  store_number              text        not null,
  business_date             date        not null,
  captured_at               timestamptz not null default now(),
  net_sales                 numeric,
  labor_cost                numeric,
  labor_hours               numeric,
  labor_pct                 numeric,     -- actual labor % (fraction, e.g. 0.20)
  target_labor_pct          numeric,     -- target labor % (fraction)
  variance_target           numeric,     -- feed's varianceTargetValue
  scheduled_labor_hours     numeric,
  actual_vs_scheduled_hours numeric,
  splh                      numeric,
  primary key (store_number, business_date)
);

create index if not exists labor_v2_daily_date_idx on labor_v2_daily (business_date desc);

alter table labor_v2_daily enable row level security;
-- No policies → client roles denied; service role (functions) bypasses RLS.

notify pgrst, 'reload schema';
