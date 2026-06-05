-- supabase/migrations/0127_walkthrough_integrity.sql
--
-- Trust & anti-gaming signals on each submission. Server-derived at submit
-- (so they can't be doctored) and surfaced in review:
--   { durationSeconds, secondsPerItem, itemsAnswered, rushed,
--     onSite, geofenceResult, exceptionReason,
--     photoCount, photoTimeMismatch, photoGeoMismatch }
--
-- No enum change — safe single block.

alter table public.walkthrough_submissions
  add column if not exists integrity jsonb;

notify pgrst, 'reload schema';
