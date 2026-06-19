-- 0168_qsr_assignments.sql
-- SOAR QSR — course assignments for the above-store manager dashboard
-- (Milestone 5). An assignment targets a scope (everyone, a region/district/
-- store, or one learner); the dashboard rolls completion up against it.

create table if not exists qsr_assignments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references qsr_courses(id) on delete cascade,
  scope_type  text not null check (scope_type in ('all','region','district','store','user')),
  scope_id    uuid,                 -- null for 'all'; else region/district/store/profile id
  scope_label text,                 -- denormalized label for display
  due_at      timestamptz,
  assigned_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists qsr_assignments_course_idx on qsr_assignments (course_id);

alter table qsr_assignments enable row level security;

-- Authors/admins manage assignments (mirrors the rest of the QSR authoring
-- surface). Broader read access for managers lands when the dashboard opens
-- beyond admins.
create policy qsr_assignments_author on qsr_assignments for all to authenticated
  using (qsr_can_author()) with check (qsr_can_author());

grant select, insert, update, delete on qsr_assignments to authenticated;

notify pgrst, 'reload schema';
