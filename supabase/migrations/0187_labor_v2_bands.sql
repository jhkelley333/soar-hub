-- 0187_labor_v2_bands.sql
-- Add Week-to-Date and Period-to-Date labor bands to labor_v2_daily so the
-- GM view can render Daily / WTD / PTD cards from the feed (the KPI feed
-- serves weekToDateData + periodToDateData sections alongside the daily one).
-- Goal/chart per band = the feed's target labor %; $ over chart is derived
-- (cost − sales×target) and hours over chart = $ over ÷ avg wage
-- (avg wage = labor_cost / labor_hours), so each band carries labor_hours.
-- Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

alter table labor_v2_daily
  add column if not exists wtd_net_sales         numeric,
  add column if not exists wtd_labor_cost        numeric,
  add column if not exists wtd_labor_hours       numeric,
  add column if not exists wtd_labor_pct         numeric,   -- fraction
  add column if not exists wtd_target_labor_pct  numeric,   -- fraction
  add column if not exists ptd_net_sales         numeric,
  add column if not exists ptd_labor_cost        numeric,
  add column if not exists ptd_labor_hours       numeric,
  add column if not exists ptd_labor_pct         numeric,   -- fraction
  add column if not exists ptd_target_labor_pct  numeric;   -- fraction

notify pgrst, 'reload schema';
