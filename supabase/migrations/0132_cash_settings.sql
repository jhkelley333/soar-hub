-- supabase/migrations/0132_cash_settings.sql
--
-- Admin-configurable tolerances for Cash Management. Two separate thresholds —
-- one for Night Closeout (drawer vs. cash-due) and one for Deposit Validation
-- (bank credit vs. expected). A single global row drives every page; the
-- backend reads it and the admin Settings tab writes it.
--
-- Service-role only (RLS on, no policies) like the other cash_* tables.

create table if not exists public.cash_settings (
  id                       text primary key default 'global',
  closeout_tolerance_cents int  not null default 500,
  deposit_tolerance_cents  int  not null default 500,
  updated_by               uuid references public.profiles(id) on delete set null,
  updated_at               timestamptz not null default now()
);

insert into public.cash_settings (id) values ('global') on conflict (id) do nothing;

alter table public.cash_settings enable row level security;

notify pgrst, 'reload schema';
