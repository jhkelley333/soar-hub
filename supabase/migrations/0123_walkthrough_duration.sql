-- supabase/migrations/0123_walkthrough_duration.sql
--
-- Records how long a walk took. Stamped server-side at submit from the
-- check-in time (or the draft's start) to the submit timestamp, so it
-- can't be doctored client-side. Surfaced in the Submissions list.
--
-- No enum change — safe single block.

alter table public.walkthrough_submissions
  add column if not exists duration_seconds int;

notify pgrst, 'reload schema';
