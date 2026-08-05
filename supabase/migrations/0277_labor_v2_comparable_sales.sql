-- 0277_labor_v2_comparable_sales.sql
-- Persist Skunkworks' same-store COMPARABLE sales bases so the Ranker + Metrics
-- Board can show vs-LY exactly like the feed (which excludes non-comparable /
-- new stores). Despite the feed's misleading names, these are dollar amounts:
--   netSalesForComparisonPercentage          -> net_sales_comp        (comparable current)
--   previousYearNetSalesForComparisonPercentage -> prev_year_net_sales_comp (comparable prior year)
-- vs-LY % = (net_sales_comp - prev_year_net_sales_comp) / prev_year_net_sales_comp,
-- which equals the feed's yoYNetSalesPercentage. Capture strips these and retries
-- until this migration runs.

alter table labor_v2_daily
  add column if not exists net_sales_comp              numeric,
  add column if not exists prev_year_net_sales_comp    numeric,
  add column if not exists wtd_net_sales_comp          numeric,
  add column if not exists wtd_prev_year_net_sales_comp numeric,
  add column if not exists ptd_net_sales_comp          numeric,
  add column if not exists ptd_prev_year_net_sales_comp numeric;

notify pgrst, 'reload schema';
