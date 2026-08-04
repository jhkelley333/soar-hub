-- 0276_count_daily_cogs_extras.sql
-- Persist two more count-feed fields per store/day for the Metrics Board's COGS
-- Efficiency section: dailyCountDollarVariance ($, can be negative) and
-- itemEfficiency (a 0-1 fraction, shown as a %). Capture strips these and
-- retries until this migration runs, so the base count scores keep landing.

alter table count_daily
  add column if not exists count_variance  numeric,
  add column if not exists item_efficiency numeric;

notify pgrst, 'reload schema';
