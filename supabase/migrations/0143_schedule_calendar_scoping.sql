-- 0143_schedule_calendar_scoping.sql
-- Market-scoped linked calendars + per-scope mutes.
--
-- Linked calendars gain a SCOPE: a calendar can be personal (only its owner),
-- or attached to an org node (store/district/area/region) or the whole company
-- (org) so everyone in/under that node inherits it. A leader can also MUTE an
-- inherited calendar for their whole market (a scope mute), and anyone can mute
-- one just for themselves (a 'user' mute). user_id remains the creator.

alter table public.schedule_linked_calendars
  add column if not exists scope_type text not null default 'personal',
  add column if not exists scope_id   uuid;

alter table public.schedule_linked_calendars
  drop constraint if exists schedule_linked_calendars_scope_chk;
alter table public.schedule_linked_calendars
  add constraint schedule_linked_calendars_scope_chk
  check (scope_type in ('personal','store','district','area','region','org'));

create index if not exists schedule_linked_calendars_scope_idx
  on public.schedule_linked_calendars (scope_type, scope_id);

-- Suppressions. scope_type 'user' (scope_id = a profile id) = "hide for just me";
-- store/district/area/region/org = "hide for that whole market".
create table if not exists public.schedule_calendar_mutes (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.schedule_linked_calendars(id) on delete cascade,
  scope_type  text not null check (scope_type in ('user','store','district','area','region','org')),
  scope_id    uuid,
  muted_by    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- One mute per (calendar, scope) — coalesce null scope_id (org) to a sentinel.
create unique index if not exists schedule_calendar_mutes_uniq
  on public.schedule_calendar_mutes
  (calendar_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists schedule_calendar_mutes_cal_idx
  on public.schedule_calendar_mutes (calendar_id);

alter table public.schedule_calendar_mutes enable row level security;
