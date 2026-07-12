-- 0238_labor_v2_ranking_fields.sql
-- Persist the KPI-feed fields the ranking engine needs that capture was
-- dropping: tickets + prior-year tickets, on-time numerator/denominator,
-- and void dollars - daily plus WTD and PTD bands. The feed already
-- carries all of these (docs/kpi-feed-fields.md); this only widens the
-- landing table. Capture code falls back to the old column set until
-- this runs. Pure ASCII.

alter table labor_v2_daily
  add column if not exists tickets                numeric,
  add column if not exists prev_year_tickets      numeric,
  add column if not exists on_time_numerator      numeric,
  add column if not exists on_time_denominator    numeric,
  add column if not exists void_total             numeric,
  add column if not exists wtd_tickets            numeric,
  add column if not exists wtd_prev_year_tickets  numeric,
  add column if not exists wtd_on_time_numerator  numeric,
  add column if not exists wtd_on_time_denominator numeric,
  add column if not exists wtd_void_total         numeric,
  add column if not exists ptd_tickets            numeric,
  add column if not exists ptd_prev_year_tickets  numeric,
  add column if not exists ptd_on_time_numerator  numeric,
  add column if not exists ptd_on_time_denominator numeric,
  add column if not exists ptd_void_total         numeric;

notify pgrst, 'reload schema';
