-- 0167_qsr_gamification.sql
--
-- SOAR QSR — Milestone 3 gamification (spec §5/§8). Server-authoritative:
-- the points ledger is the source of truth for totals; streaks track
-- consecutive active days; badges are rule-based + awarded idempotently.
-- All reference the existing profiles table (single-tenant).

-- Every points change, append-only.
create table if not exists qsr_points_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  delta      integer not null,
  reason     text not null,                 -- 'quiz_correct' | 'lesson_complete' | …
  course_id  uuid references qsr_courses(id) on delete set null,
  card_id    uuid references qsr_cards(id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists qsr_points_ledger_user_idx on qsr_points_ledger (user_id, at);
-- Idempotency guard for one-shot awards (e.g. a course's completion bonus).
create unique index if not exists qsr_points_ledger_once
  on qsr_points_ledger (user_id, course_id, reason)
  where course_id is not null and card_id is null;

create table if not exists qsr_streaks (
  user_id          uuid primary key references profiles(id) on delete cascade,
  current          integer not null default 0,
  longest          integer not null default 0,
  last_active_date date,
  updated_at       timestamptz not null default now()
);

create table if not exists qsr_badges (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  name       text not null,
  icon       text,
  criteria   jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0
);

create table if not exists qsr_user_badges (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  badge_id  uuid not null references qsr_badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  unique (user_id, badge_id)
);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table qsr_points_ledger enable row level security;
alter table qsr_streaks       enable row level security;
alter table qsr_badges        enable row level security;
alter table qsr_user_badges   enable row level security;

-- A learner reads their own ledger/streak/badges (leaderboards go through the
-- service-role function, so cross-user reads don't need a policy here).
create policy qsr_points_ledger_own on qsr_points_ledger for select to authenticated
  using (user_id = auth.uid());
create policy qsr_streaks_own on qsr_streaks for select to authenticated
  using (user_id = auth.uid());
create policy qsr_user_badges_own on qsr_user_badges for select to authenticated
  using (user_id = auth.uid());
-- Badge catalog is readable by everyone signed in.
create policy qsr_badges_read on qsr_badges for select to authenticated using (true);

grant select on qsr_points_ledger, qsr_streaks, qsr_badges, qsr_user_badges to authenticated;

-- ── Seed the v1 badge catalog ─────────────────────────────────────────────
insert into qsr_badges (key, name, icon, criteria, sort_order) values
  ('first_lesson',  'First Lesson',  'rocket',  '{"type":"lessons_completed","gte":1}', 1),
  ('perfect_score', 'Perfect Score', 'target',  '{"type":"perfect_lesson"}',            2),
  ('streak_3',      '3-Day Streak',  'flame',   '{"type":"streak","gte":3}',            3),
  ('streak_7',      '7-Day Streak',  'flame',   '{"type":"streak","gte":7}',            4)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
