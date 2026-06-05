-- supabase/migrations/0133_cash_carried_over_entry.sql
--
-- Re-model "Carried Over" on deposit validation to match the Micros Oracle
-- DSR meaning: open guest checks carried from the prior business day —
-- a COUNT of open checks + their DOLLAR value — ENTERED by the person doing
-- deposit validation (not computed from variance).
--
-- dsr_carried_over_cents (already present) now holds the entered dollar value;
-- this adds the entered count alongside it.
--
-- Idempotent.

alter table public.cash_deposits
  add column if not exists carried_over_count int not null default 0;

comment on column public.cash_deposits.dsr_carried_over_cents is
  'Carried-over open-check DOLLARS from the prior-day DSR, entered at deposit validation.';
comment on column public.cash_deposits.carried_over_count is
  'Carried-over open-check COUNT from the prior-day DSR, entered at deposit validation.';

notify pgrst, 'reload schema';
