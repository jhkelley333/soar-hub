-- supabase/migrations/0128_paf_resubmitted_by.sql
--
-- "Edit & resubmit on behalf of" — when an SDO/RVP (or above) fixes and
-- resubmits a rejected PAF that someone else filed, the PAF stays owned by
-- the original submitter, but we record who actually did the edit so the
-- later outcome emails (Processed / Rejected / SDO decision) can also CC
-- that leader to track it.
--
-- Cleared back to null whenever the original submitter resubmits their own
-- PAF, so the CC never goes stale.
--
-- No enum change — safe single block.

alter table public.paf_submissions
  add column if not exists resubmitted_by_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists resubmitted_by_email text;

notify pgrst, 'reload schema';
