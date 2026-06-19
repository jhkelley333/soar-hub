-- supabase/migrations/0139_schedule_events.sql
--
-- Schedule module v1 — native calendar events. The Schedule view unions these
-- with read-only feeds from other modules (training, PTO, walkthroughs, reno —
-- added in a later phase) and, eventually, Google Calendar. This table is just
-- the SOAR-native, hand-created events.
--
-- Org attachment: every event is pinned to ONE node of the org tree
-- (store / district / area / region / org-wide). That drives both the
-- visibility scope (a user sees events whose node rolls up into their visible
-- stores) and the org-tree filter in the UI. store_number is denormalized for
-- store-level events so the common case needs no join.
--
-- Service-role backend only (RLS on, no policies), same gatekeeper model as
-- cash_* / employee_action_* tables. Idempotent.

create table if not exists public.schedule_events (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  type            text not null default 'other'
                    check (type in (
                      'store_visit','audit','renovation','training',
                      'manager_meeting','pto','delivery','deadline','other'
                    )),
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  all_day         boolean not null default false,

  -- Org attachment (one node).
  scope_type      text not null default 'store'
                    check (scope_type in ('store','district','area','region','org')),
  scope_id        uuid,                 -- the node's id; null for org-wide
  store_number    text,                 -- denormalized for store-level events

  notes           text,
  color           text,                 -- optional per-event color override

  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists schedule_events_starts_idx on public.schedule_events (starts_at);
create index if not exists schedule_events_scope_idx  on public.schedule_events (scope_type, scope_id);
create index if not exists schedule_events_store_idx  on public.schedule_events (store_number);

alter table public.schedule_events enable row level security;

notify pgrst, 'reload schema';
