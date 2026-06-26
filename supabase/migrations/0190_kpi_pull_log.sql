-- 0190_kpi_pull_log.sql
-- Append-only log of every KPI/Labor v2 feed pull — the scheduled capture
-- (kpi-capture), the manual admin Refresh, and the rollup self-heal — so the
-- pull history + failures are visible on a log page. Service-only: RLS on, no
-- policies. Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

create table if not exists kpi_pull_log (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  source         text        not null,   -- 'cron' | 'refresh' | 'self-heal'
  ok             boolean     not null,
  business_date  date,                    -- the feed's business date (on success)
  store_rows     int,                     -- labor_v2_daily rows written
  wtd_rows       int,
  ptd_rows       int,
  kpi_snapshot   boolean,                 -- did the raw snapshot write (cron only)
  central_date   text,                    -- cron context
  central_hour   int,
  triggered_by   text,                    -- email, for manual refresh
  duration_ms    int,
  error          text
);
create index if not exists kpi_pull_log_created_idx on kpi_pull_log (created_at desc);

alter table kpi_pull_log enable row level security;
-- No policies → client roles denied; service role (functions) bypasses RLS.
