-- supabase/migrations/0135_cash_late_closeout.sql
--
-- Retro / late closeout support.
--
-- When a store team forgets to close out at end of day, an authorized closeout
-- role can backfill the missed day (within the last 7 days, only days that have
-- no closeout yet). Such a closeout is marked is_late = true so leadership can
-- see it wasn't done on time, and an optional late_note records why.
--
-- The normal daily flow leaves is_late = false. Over-tolerance variances still
-- escalate exactly as before; "late" is an independent flag, not a discrepancy.
-- Idempotent.

alter table public.cash_closeouts
  add column if not exists is_late boolean not null default false;

alter table public.cash_closeouts
  add column if not exists late_note text;

-- Lets the DSR / dashboard history cheaply surface late days.
create index if not exists cash_closeouts_late_idx
  on public.cash_closeouts(store_id, business_date desc)
  where is_late;

notify pgrst, 'reload schema';
