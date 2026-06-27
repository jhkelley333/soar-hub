-- 0194_qsr_training_events.sql
-- Per-user audit of the "required training" interstitial popup. Tracks whether
-- each surfacing of a course on the login interstitial was Shown, then
-- Dismissed (X / Later) or Started (clicked "Start training"). Leadership can
-- use this to see who has and hasn't engaged with assigned training before
-- escalating in person. Writes go through qsr-learn (service-role), reads via
-- a future admin-only endpoint, so no client-facing RLS policy is needed.

create table if not exists public.qsr_training_events (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  course_id   uuid        not null references public.qsr_courses(id) on delete cascade,
  action      text        not null check (action in ('shown', 'started', 'dismissed')),
  event_data  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists qsr_training_events_user_idx on public.qsr_training_events(user_id, created_at desc);
create index if not exists qsr_training_events_course_idx on public.qsr_training_events(course_id, created_at desc);
-- Skim "who saw what when" by action quickly.
create index if not exists qsr_training_events_action_idx on public.qsr_training_events(action, created_at desc);

-- Locked down: all access through the qsr-learn service-role function. RLS on
-- with no policy denies direct anon/auth access.
alter table public.qsr_training_events enable row level security;

notify pgrst, 'reload schema';
