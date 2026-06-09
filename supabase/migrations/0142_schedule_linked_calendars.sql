-- 0142_schedule_linked_calendars.sql
-- External (read-only) calendar subscriptions for the Schedule. A user links
-- a calendar by its iCal/ICS URL (e.g. a Google "secret iCal address", Apple,
-- or Outlook share link); the backend fetches + parses it and overlays the
-- events. No OAuth — the URL is the credential, owned per user.
--
-- Service-role gatekeeper pattern: RLS is enabled with no policies, so only
-- the Netlify functions (service key) touch this table; they scope every read
-- and write to the authenticated owner.

create table if not exists public.schedule_linked_calendars (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  label        text not null,
  url          text not null,
  color        text not null default 'blue',
  is_enabled   boolean not null default true,
  last_synced_at timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists schedule_linked_calendars_user_idx
  on public.schedule_linked_calendars (user_id);

alter table public.schedule_linked_calendars enable row level security;
