-- 0211_count_daily.sql
-- Per-store, per-day inventory COUNT scores from the Expressway KPI feed
-- (same feed as Labor v2). One row per (store_number, business_date); the
-- scheduled KPI puller upserts, so the latest pull wins and history accrues
-- going forward for trend charts. Scores are stored as fractions from the
-- feed (0.67 = 67%). Service-only: RLS on, no policies.

create table if not exists count_daily (
  store_number          text        not null,
  business_date         date        not null,
  captured_at           timestamptz not null default now(),
  daily_score           numeric,    -- overall daily count score (fraction)
  completion_score      numeric,    -- % of counts completed
  accuracy_score        numeric,    -- count accuracy
  total_intellicost_pct numeric,    -- totalIntelliCostPercentage from the feed
  primary key (store_number, business_date)
);

create index if not exists count_daily_date_idx on count_daily (business_date desc);

alter table count_daily enable row level security;
-- No policies → client roles denied; service role (functions) bypasses RLS.

notify pgrst, 'reload schema';
