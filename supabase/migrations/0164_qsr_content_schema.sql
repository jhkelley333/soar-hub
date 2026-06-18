-- 0164_qsr_content_schema.sql
--
-- SOAR QSR Learning Platform — Milestone 1 data foundation.
-- Adapts the spec §5 data model to soar-hub: instead of duplicating
-- Org/Region/Store/User, we reuse the existing profiles / stores / regions.
-- This migration covers the CONTENT + LEARNER-PROGRESS spine (Milestones 1–2).
-- Gamification, certs, validations, reports, etc. land with their own
-- milestones to avoid dead schema.
--
-- Card.data is a jsonb blob validated per type (spec §6) at the app layer.
-- Server stays the source of truth for progress/scoring (RLS scopes each row).

-- ── Role capability helper ────────────────────────────────────────────────
-- L&D Author / Org Admin map to admin for now. Tunable in one place: widen
-- this to add a dedicated author grant later without touching every policy.
create or replace function qsr_can_author()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role::text in ('admin') from public.profiles where id = auth.uid()), false);
$$;

-- ── Content: courses → lessons → cards ────────────────────────────────────
create table if not exists qsr_courses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text,
  description text,
  status      text not null default 'draft' check (status in ('draft', 'published')),
  est_minutes integer,
  points      integer not null default 0,
  version     integer not null default 1,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists qsr_lessons (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references qsr_courses(id) on delete cascade,
  title      text not null,
  module     text,
  ord        integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists qsr_lessons_course_idx on qsr_lessons (course_id, ord);

create table if not exists qsr_cards (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references qsr_lessons(id) on delete cascade,
  ord        integer not null default 0,
  type       text not null check (type in ('intro','steps','image','video','quiz','reveal','poll','done')),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists qsr_cards_lesson_idx on qsr_cards (lesson_id, ord);

-- ── Learner progress ──────────────────────────────────────────────────────
create table if not exists qsr_enrollments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  course_id    uuid not null references qsr_courses(id) on delete cascade,
  status       text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, course_id)
);

create table if not exists qsr_card_progress (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references qsr_enrollments(id) on delete cascade,
  card_id       uuid not null references qsr_cards(id) on delete cascade,
  state         text not null check (state in ('seen', 'answered', 'passed')),
  answer_index  integer,
  correct       boolean,
  watched_pct   numeric,
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, card_id)
);

create table if not exists qsr_quiz_attempts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  card_id        uuid not null references qsr_cards(id) on delete cascade,
  answer_index   integer not null,
  correct        boolean not null,
  points_awarded integer not null default 0,
  at             timestamptz not null default now()
);
create index if not exists qsr_quiz_attempts_user_idx on qsr_quiz_attempts (user_id, card_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table qsr_courses       enable row level security;
alter table qsr_lessons       enable row level security;
alter table qsr_cards         enable row level security;
alter table qsr_enrollments   enable row level security;
alter table qsr_card_progress enable row level security;
alter table qsr_quiz_attempts enable row level security;

-- Content: any signed-in user reads PUBLISHED courses; authors read/write all.
create policy qsr_courses_read on qsr_courses for select to authenticated
  using (status = 'published' or qsr_can_author());
create policy qsr_courses_write on qsr_courses for all to authenticated
  using (qsr_can_author()) with check (qsr_can_author());

create policy qsr_lessons_read on qsr_lessons for select to authenticated
  using (exists (select 1 from qsr_courses c where c.id = qsr_lessons.course_id
                 and (c.status = 'published' or qsr_can_author())));
create policy qsr_lessons_write on qsr_lessons for all to authenticated
  using (qsr_can_author()) with check (qsr_can_author());

create policy qsr_cards_read on qsr_cards for select to authenticated
  using (exists (select 1 from qsr_lessons l join qsr_courses c on c.id = l.course_id
                 where l.id = qsr_cards.lesson_id
                 and (c.status = 'published' or qsr_can_author())));
create policy qsr_cards_write on qsr_cards for all to authenticated
  using (qsr_can_author()) with check (qsr_can_author());

-- Progress: a learner owns their rows. Authors may read all (analytics later).
create policy qsr_enrollments_rw on qsr_enrollments for all to authenticated
  using (user_id = auth.uid() or qsr_can_author())
  with check (user_id = auth.uid());

create policy qsr_card_progress_rw on qsr_card_progress for all to authenticated
  using (exists (select 1 from qsr_enrollments e where e.id = qsr_card_progress.enrollment_id
                 and (e.user_id = auth.uid() or qsr_can_author())))
  with check (exists (select 1 from qsr_enrollments e where e.id = qsr_card_progress.enrollment_id
                 and e.user_id = auth.uid()));

create policy qsr_quiz_attempts_rw on qsr_quiz_attempts for all to authenticated
  using (user_id = auth.uid() or qsr_can_author())
  with check (user_id = auth.uid());

-- Grants (RLS still gates every row).
grant select, insert, update, delete on
  qsr_courses, qsr_lessons, qsr_cards, qsr_enrollments, qsr_card_progress, qsr_quiz_attempts
  to authenticated;

-- Convenience view for catalog listings: course + lesson/card counts.
-- security_invoker so the base-table RLS (published-only for learners) applies.
create or replace view qsr_course_summary with (security_invoker = true) as
  select c.id, c.title, c.category, c.description, c.status, c.est_minutes, c.points,
         count(distinct l.id) as lesson_count,
         count(distinct cd.id) as card_count
  from qsr_courses c
  left join qsr_lessons l on l.course_id = c.id
  left join qsr_cards cd on cd.lesson_id = l.id
  group by c.id;
grant select on qsr_course_summary to authenticated;

notify pgrst, 'reload schema';
