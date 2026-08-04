-- 0274_labor_v2_l2r.sql
-- Persist the feed's guest Likely-to-Return percentage (likelyToReturnPercentage)
-- into labor_v2_daily for the daily / WTD / PTD bands, so the Execution Metrics
-- Board's Customer L2R section can show it (scope value = mean of reporting
-- stores). Capture strips these columns and retries until this migration runs,
-- so the hourly capture keeps landing without them. These feed fields are often
-- null, so the metric may read "—" until real guest-feedback data flows.

alter table labor_v2_daily
  add column if not exists likely_to_return_pct       numeric,
  add column if not exists wtd_likely_to_return_pct   numeric,
  add column if not exists ptd_likely_to_return_pct   numeric;

notify pgrst, 'reload schema';
