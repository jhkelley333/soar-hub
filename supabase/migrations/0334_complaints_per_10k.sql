-- 0334_complaints_per_10k.sql
-- Adds complaints + complaints_per_10k (daily / WTD / PTD) to labor_v2_daily.
-- The KPI feed delivers these fields but the ingest layer was not capturing them.
ALTER TABLE public.labor_v2_daily
  ADD COLUMN IF NOT EXISTS complaints             numeric,
  ADD COLUMN IF NOT EXISTS complaints_per_10k     numeric,
  ADD COLUMN IF NOT EXISTS wtd_complaints         numeric,
  ADD COLUMN IF NOT EXISTS wtd_complaints_per_10k numeric,
  ADD COLUMN IF NOT EXISTS ptd_complaints         numeric,
  ADD COLUMN IF NOT EXISTS ptd_complaints_per_10k numeric;
