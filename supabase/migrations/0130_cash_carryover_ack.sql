-- supabase/migrations/0130_cash_carryover_ack.sql
--
-- Carried-over balance handling on deposit validation. A nonzero carried-over
-- (over/short rolled forward from prior unreconciled closeouts) must now be
-- explicitly RECORDED + ADDRESSED by the closer at validation, AND it raises a
-- discrepancy alert for the store's DO/SDO to resolve. This adds:
--   * acknowledgement columns on cash_deposits (who/when/note)
--   * 'carryover' as a valid cash_alerts.source
--
-- Idempotent.

alter table public.cash_deposits
  add column if not exists carried_ack     boolean not null default false,
  add column if not exists carried_note    text,
  add column if not exists carried_ack_by  uuid references public.profiles(id) on delete set null,
  add column if not exists carried_ack_at  timestamptz;

-- Extend the alert source check to include carried-over escalations.
alter table public.cash_alerts drop constraint if exists cash_alerts_source_check;
alter table public.cash_alerts
  add constraint cash_alerts_source_check
  check (source in ('closeout', 'deposit', 'carryover'));

notify pgrst, 'reload schema';
