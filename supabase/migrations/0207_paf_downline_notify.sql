-- 0207_paf_downline_notify.sql
-- Opt-in for SDO/RVP/VP/COO to be copied on PAF submission + discussion
-- emails for PAFs within their own downline.

alter table public.profiles
  add column if not exists notify_paf_downline boolean not null default false;

notify pgrst, 'reload schema';
