-- 0186_labor_v2_overtime_hours.sql
-- Add overtime_hours to labor_v2_daily (sourced from the feed's overTimeHours).
-- Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

alter table labor_v2_daily add column if not exists overtime_hours numeric;

notify pgrst, 'reload schema';
