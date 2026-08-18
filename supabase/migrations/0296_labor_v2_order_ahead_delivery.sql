-- 0296_labor_v2_order_ahead_delivery.sql
-- Capture the KPI feed's Order Ahead and Delivery net-sales penetration (net
-- sales + their denominators) so the Metrics Board's Grow Sales pillar can show
-- Order Ahead % and Delivery % of sales. Daily plus the WTD/PTD bands, mirroring
-- the other captured feed fields. Capture strips these and retries until this
-- migration runs.

alter table labor_v2_daily
  add column if not exists order_ahead_net_sales                 numeric,
  add column if not exists order_ahead_net_sales_denominator     numeric,
  add column if not exists delivery_net_sales                    numeric,
  add column if not exists delivery_net_sales_denominator        numeric,
  add column if not exists wtd_order_ahead_net_sales             numeric,
  add column if not exists wtd_order_ahead_net_sales_denominator numeric,
  add column if not exists wtd_delivery_net_sales                numeric,
  add column if not exists wtd_delivery_net_sales_denominator    numeric,
  add column if not exists ptd_order_ahead_net_sales             numeric,
  add column if not exists ptd_order_ahead_net_sales_denominator numeric,
  add column if not exists ptd_delivery_net_sales                numeric,
  add column if not exists ptd_delivery_net_sales_denominator    numeric;

notify pgrst, 'reload schema';
