-- 0228_labor_v2_prev_year_sales.sql
-- Store the feed's previous-year net sales alongside each labor row (daily,
-- WTD, PTD) so the Command Center can show sales vs last year without an
-- extra feed call. Populated by the Labor v2 pull from the next refresh on.
-- Pure ASCII.

alter table labor_v2_daily
  add column if not exists prev_year_net_sales      numeric,
  add column if not exists wtd_prev_year_net_sales  numeric,
  add column if not exists ptd_prev_year_net_sales  numeric;

notify pgrst, 'reload schema';
