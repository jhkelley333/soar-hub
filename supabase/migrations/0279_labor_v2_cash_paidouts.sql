-- 0279_labor_v2_cash_paidouts.sql
-- Capture the KPI feed's Cash Over/Short and Paid Out dollars so the Metrics
-- Board's section 05 (Other Controllable Contribution) can show them. Daily plus
-- the WTD/PTD bands, mirroring the other captured feed fields. Capture strips
-- these and retries until this migration runs.

alter table labor_v2_daily
  add column if not exists cash_over_short          numeric,
  add column if not exists paid_out_dollars         numeric,
  add column if not exists wtd_cash_over_short       numeric,
  add column if not exists wtd_paid_out_dollars      numeric,
  add column if not exists ptd_cash_over_short       numeric,
  add column if not exists ptd_paid_out_dollars      numeric;

notify pgrst, 'reload schema';
