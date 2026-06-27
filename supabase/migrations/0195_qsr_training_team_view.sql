-- 0195_qsr_training_team_view.sql
-- Two helpers that power the next slice of training visibility:
--
--   1. qsr_assignments_for_user(uid) — every qsr_assignments row that applies
--      to the user via their direct ('user') scope, their primary store, that
--      store's district, area, or region, or 'all'. Lets the login popup
--      surface assignment-driven outstanding training in addition to
--      role+cadence required training.
--
--   2. qsr_user_training_summary(uid) — small per-user roll-up the team-mgmt
--      list joins onto each member: outstanding_count (role-required +
--      assignment-driven, deduped) plus shown/started/dismissed counts from
--      qsr_training_events over the last 30 days so leadership can see at a
--      glance who has and hasn't engaged with the popup.

-- ── 1. Assignments-for-user ──────────────────────────────────────────────
create or replace function public.qsr_assignments_for_user(uid uuid)
returns table (
  assignment_id uuid,
  course_id     uuid,
  scope_type    text,
  scope_id      uuid,
  due_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select id as user_id, primary_store_id as store_id
    from profiles where id = uid
  ),
  s as (
    select stores.id as store_id, stores.district_id from stores
    where stores.id = (select store_id from u)
  ),
  d as (
    select districts.id as district_id, districts.area_id from districts
    where districts.id = (select district_id from s)
  ),
  a as (
    select areas.id as area_id, areas.region_id from areas
    where areas.id = (select area_id from d)
  )
  select qa.id, qa.course_id, qa.scope_type, qa.scope_id, qa.due_at
  from qsr_assignments qa
  where
    (qa.scope_type = 'all')
    or (qa.scope_type = 'user'     and qa.scope_id = uid)
    or (qa.scope_type = 'store'    and qa.scope_id = (select store_id from u))
    or (qa.scope_type = 'district' and qa.scope_id = (select district_id from s))
    or (qa.scope_type = 'area'     and qa.scope_id = (select area_id from d))
    or (qa.scope_type = 'region'   and qa.scope_id = (select region_id from a));
$$;
grant execute on function public.qsr_assignments_for_user(uuid) to authenticated, service_role;

-- ── 2. Per-user training summary ─────────────────────────────────────────
create or replace function public.qsr_user_training_summary(uid uuid)
returns table (
  outstanding_count integer,
  shown_30d         integer,
  started_30d       integer,
  dismissed_30d     integer
)
language sql
stable
security definer
set search_path = public
as $$
  with caller_role as (
    select role::text as r from profiles where id = uid
  ),
  -- Role-required courses for the caller's role: published, cadence set,
  -- caller's role listed in requirement_roles. "Outstanding" = not completed
  -- within the cadence window (annual = last 365 days, anything else = 90).
  role_required_outstanding as (
    select c.id as course_id
    from qsr_courses c
    join caller_role cr on cr.r = any(c.requirement_roles)
    where c.status = 'published'
      and c.requirement_cadence is not null
      and not exists (
        select 1 from qsr_enrollments e
        where e.user_id = uid and e.course_id = c.id and e.status = 'completed'
          and e.completed_at >= case
            when c.requirement_cadence = 'annual' then now() - interval '365 days'
            else now() - interval '90 days'
          end
      )
  ),
  -- Assignment-driven courses: any qsr_assignments row that applies (via the
  -- helper above) where the user has no completed enrollment.
  assigned_outstanding as (
    select distinct a.course_id
    from qsr_assignments_for_user(uid) a
    where not exists (
      select 1 from qsr_enrollments e
      where e.user_id = uid and e.course_id = a.course_id and e.status = 'completed'
    )
  ),
  outstanding as (
    select course_id from role_required_outstanding
    union
    select course_id from assigned_outstanding
  ),
  events as (
    select
      count(*) filter (where action = 'shown')     as shown,
      count(*) filter (where action = 'started')   as started,
      count(*) filter (where action = 'dismissed') as dismissed
    from qsr_training_events
    where user_id = uid and created_at >= now() - interval '30 days'
  )
  select
    (select count(*)::int from outstanding),
    coalesce((select shown::int from events), 0),
    coalesce((select started::int from events), 0),
    coalesce((select dismissed::int from events), 0);
$$;
grant execute on function public.qsr_user_training_summary(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
