-- 0189_labor_v2_band_hours.sql
-- Capture scheduled / overtime / actual-vs-scheduled hours for the WTD and PTD
-- bands too (the daily columns already exist from 0185/0186), so the Labor v2
-- rollup can show Sched / OT / Act−Sched on the WTD and PTD views, not just
-- Daily. Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

alter table labor_v2_daily
  add column if not exists wtd_scheduled_labor_hours      numeric,
  add column if not exists wtd_overtime_hours             numeric,
  add column if not exists wtd_actual_vs_scheduled_hours  numeric,
  add column if not exists ptd_scheduled_labor_hours      numeric,
  add column if not exists ptd_overtime_hours             numeric,
  add column if not exists ptd_actual_vs_scheduled_hours  numeric;

notify pgrst, 'reload schema';
