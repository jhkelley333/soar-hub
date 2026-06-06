-- supabase/migrations/0134_cash_audit_log.sql
--
-- Action history for Cash Management. Records who did what + when across the
-- closeout/deposit/alert lifecycle so the detail view can show a timeline and
-- admins have an audit trail (e.g. when a closeout was edited to fix a
-- wrong-day entry). Service-role only (RLS on, no policies) like the other
-- cash_* tables.

create table if not exists public.cash_audit_log (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('closeout', 'deposit', 'alert')),
  action       text not null,          -- submit | edit | verify-deposit | alert-ack | alert-resolve
  store_id     uuid references public.stores(id)          on delete set null,
  closeout_id  uuid references public.cash_closeouts(id)  on delete set null,
  deposit_id   uuid references public.cash_deposits(id)   on delete set null,
  alert_id     uuid references public.cash_alerts(id)     on delete set null,
  detail       jsonb,
  actor_id     uuid references public.profiles(id)        on delete set null,
  actor_name   text,
  created_at   timestamptz not null default now()
);

create index if not exists cash_audit_closeout_idx on public.cash_audit_log(closeout_id);
create index if not exists cash_audit_store_idx    on public.cash_audit_log(store_id);
create index if not exists cash_audit_created_idx  on public.cash_audit_log(created_at desc);

alter table public.cash_audit_log enable row level security;

notify pgrst, 'reload schema';
