-- 0297_report_engine.sql
-- Phase 1 foundation: the scheduled/event report engine. A generic settings
-- store, keyed report definitions with settings-driven recipients, an immutable
-- run log, and a per-window claim ledger for idempotent dispatch. RLS + the
-- immutability trigger ship in this same migration (never retrofit either).

-- ── system_settings ──────────────────────────────────────────────────────────
-- Generic KV for engine config + report recipients that resolve at send time,
-- so a role change or a new address is a settings edit, not a deploy.
create table if not exists public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.system_settings enable row level security;

-- Any signed-in user may READ settings (the app resolves recipients/config
-- server-side with the service role; this covers direct client reads).
create policy system_settings_read on public.system_settings
  for select using (auth.uid() is not null);
-- Only admins may WRITE.
create policy system_settings_admin_write on public.system_settings
  for all using (is_admin()) with check (is_admin());

-- ── report_definitions ───────────────────────────────────────────────────────
-- One row per report. `recipients` is a list of {mode:'role'|'static', value}.
-- `trigger_type` = 'schedule' (cron) or 'event' (fired inline by an action).
create table if not exists public.report_definitions (
  key             text primary key,          -- e.g. 'monday_no_gm_credit'
  name            text not null,
  description     text,
  trigger_type    text not null default 'schedule'
                    check (trigger_type in ('schedule','event')),
  cron            text,                       -- 5-field, null for event-driven
  timezone        text not null default 'America/Chicago',
  enabled         boolean not null default true,
  recipients      jsonb not null default '[]'::jsonb,
  send_when_empty boolean not null default true,
  last_run_at     timestamptz,
  last_status     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

alter table public.report_definitions enable row level security;

create policy report_definitions_read on public.report_definitions
  for select using (auth.uid() is not null);
create policy report_definitions_admin_write on public.report_definitions
  for all using (is_admin()) with check (is_admin());

-- ── report_run_windows ───────────────────────────────────────────────────────
-- Idempotency / overlap guard. The dispatcher claims a report's scheduled slot
-- by inserting (report_key, window_start) BEFORE doing any work; a unique PK
-- means a second overlapping dispatcher loses the race and skips — so a report
-- sends at most once per window. Mutable on purpose (old claims can be pruned);
-- the immutable audit lives in report_runs.
create table if not exists public.report_run_windows (
  report_key   text not null references public.report_definitions(key) on delete cascade,
  window_start timestamptz not null,
  claimed_at   timestamptz not null default now(),
  primary key (report_key, window_start)
);

alter table public.report_run_windows enable row level security;
-- No client policies — service-role only (bypasses RLS). RLS on with zero
-- policies denies all non-service access.

-- ── report_runs (IMMUTABLE) ──────────────────────────────────────────────────
-- Append-only audit of every dispatch. Written once, at completion, with the
-- terminal status. Enforced immutable at the DB layer (below), not in app code.
create table if not exists public.report_runs (
  id              uuid primary key default gen_random_uuid(),
  report_key      text not null references public.report_definitions(key),
  window_start    timestamptz,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  status          text not null check (status in ('success','failed','skipped')),
  recipient_count int,
  row_count       int,
  error           text,
  payload_summary jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists report_runs_key_created_idx
  on public.report_runs (report_key, created_at desc);

alter table public.report_runs enable row level security;
-- Admins can READ the run history in the admin UI. INSERT happens via the
-- service role (bypasses RLS). UPDATE/DELETE have no policy AND raise below.
create policy report_runs_admin_read on public.report_runs
  for select using (is_admin());

-- Immutability: block every UPDATE and DELETE at the DB layer — this fires even
-- for the service role, so a finished run can never be altered or removed.
create or replace function public.report_runs_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'report_runs is immutable (% blocked)', tg_op;
end;
$$;

drop trigger if exists report_runs_no_mutate on public.report_runs;
create trigger report_runs_no_mutate
  before update or delete on public.report_runs
  for each row execute function public.report_runs_immutable();

-- ── seed: a disabled smoke-test report ───────────────────────────────────────
-- Handler lives in code (registry key 'smoke_test'). Ships disabled so it never
-- auto-emails; verify with "Send test now" in /admin/reports, or enable it with
-- a tight cron to prove scheduled delivery. Recipients default to admins.
insert into public.report_definitions (key, name, description, trigger_type, cron, enabled, recipients, send_when_empty)
values (
  'smoke_test',
  'Smoke test',
  'Engine smoke test — confirms scheduled render + Resend delivery. Disabled by default.',
  'schedule', '0 8 * * 1', false,
  '[{"mode":"role","value":"admin"}]'::jsonb, true
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
