-- 0331_ew_schedule_status_log.sql
-- Creates immutable daily diary of schedule status checks, auto-populated via trigger on ew_schedule_status.

-- ── diary table ───────────────────────────────────────────────────────────────
CREATE TABLE public.ew_schedule_status_log (
  store_number          text        NOT NULL,
  week_start            date        NOT NULL,
  checked_date          date        NOT NULL,
  status                smallint,
  status_step           smallint,
  status_label          text,
  forecast              numeric(12,2),
  adjusted_forecast     numeric(12,2),
  projected_splh        numeric(10,2),
  scheduled_labor_pct   numeric(6,4),
  target_labor_pct      numeric(6,4),
  budget_usage          numeric(6,4),
  rvp                   text,
  sdo                   text,
  do_name               text,
  pulled_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_number, week_start, checked_date)
);

CREATE INDEX idx_ew_schedule_status_log_week_date
  ON public.ew_schedule_status_log (week_start, checked_date);

ALTER TABLE public.ew_schedule_status_log ENABLE ROW LEVEL SECURITY;

-- ── trigger function ──────────────────────────────────────────────────────────
-- Each upsert to ew_schedule_status auto-logs a snapshot keyed by local date
-- (America/Chicago). Multiple runs in the same day overwrite, keeping the latest.
CREATE OR REPLACE FUNCTION public._log_schedule_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ew_schedule_status_log (
    store_number, week_start, checked_date,
    status, status_step, status_label,
    forecast, adjusted_forecast, projected_splh,
    scheduled_labor_pct, target_labor_pct, budget_usage,
    rvp, sdo, do_name, pulled_at
  ) VALUES (
    NEW.store_number,
    NEW.week_start,
    (NEW.pulled_at AT TIME ZONE 'America/Chicago')::date,
    NEW.status, NEW.status_step, NEW.status_label,
    NEW.forecast, NEW.adjusted_forecast, NEW.projected_splh,
    NEW.scheduled_labor_pct, NEW.target_labor_pct, NEW.budget_usage,
    NEW.rvp, NEW.sdo, NEW.do_name, NEW.pulled_at
  )
  ON CONFLICT (store_number, week_start, checked_date) DO UPDATE SET
    status               = EXCLUDED.status,
    status_step          = EXCLUDED.status_step,
    status_label         = EXCLUDED.status_label,
    forecast             = EXCLUDED.forecast,
    adjusted_forecast    = EXCLUDED.adjusted_forecast,
    projected_splh       = EXCLUDED.projected_splh,
    scheduled_labor_pct  = EXCLUDED.scheduled_labor_pct,
    target_labor_pct     = EXCLUDED.target_labor_pct,
    budget_usage         = EXCLUDED.budget_usage,
    rvp                  = EXCLUDED.rvp,
    sdo                  = EXCLUDED.sdo,
    do_name              = EXCLUDED.do_name,
    pulled_at            = EXCLUDED.pulled_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_schedule_status_change
  AFTER INSERT OR UPDATE ON public.ew_schedule_status
  FOR EACH ROW
  EXECUTE FUNCTION public._log_schedule_status_change();

-- ── backfill existing rows ────────────────────────────────────────────────────
-- Seeds the log with the data already in ew_schedule_status (each row's
-- pulled_at date becomes its first checked_date entry).
INSERT INTO public.ew_schedule_status_log (
  store_number, week_start, checked_date,
  status, status_step, status_label,
  forecast, adjusted_forecast, projected_splh,
  scheduled_labor_pct, target_labor_pct, budget_usage,
  rvp, sdo, do_name, pulled_at
)
SELECT
  store_number, week_start,
  (pulled_at AT TIME ZONE 'America/Chicago')::date,
  status, status_step, status_label,
  forecast, adjusted_forecast, projected_splh,
  scheduled_labor_pct, target_labor_pct, budget_usage,
  rvp, sdo, do_name, pulled_at
FROM public.ew_schedule_status
ON CONFLICT (store_number, week_start, checked_date) DO NOTHING;
