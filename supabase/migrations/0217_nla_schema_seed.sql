-- 0217_nla_schema_seed.sql
-- Next Level Assessment (NLA) — Phase 1: the instrument + a cycle + the
-- self-vs-leader comparison view, seeded with the Shift Manager → Assistant GM
-- template v1 (16 competencies). Feeds the PDP + succession loop.
--
-- Access: service-role gatekeeper — RLS on, NO policies. The `nla` function
-- scope-checks every read/write (same pattern as team-pipeline). Immutability of
-- locked ratings is enforced at the DB via triggers (defense in depth), so a
-- submitted assessment can't be quietly edited even through the service role.

-- ── Instrument (role-keyed, versioned) ───────────────────────────────────────
create table if not exists tp_nla_templates (
  id             uuid primary key default gen_random_uuid(),
  target_role    text not null,                  -- ladder key of the target role
  version        int  not null default 1,
  title          text not null,
  status         text not null default 'active', -- draft | active | retired
  effective_date date,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index if not exists tp_nla_templates_role_ver on tp_nla_templates (target_role, version);

create table if not exists tp_nla_template_items (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references tp_nla_templates(id) on delete cascade,
  category        text not null,
  sort_order      int  not null default 0,
  competency_key  text not null,                 -- stable slug, survives versions
  name            text not null,
  description     text,
  example         text
);
create unique index if not exists tp_nla_items_tpl_key on tp_nla_template_items (template_id, competency_key);
create index if not exists tp_nla_items_tpl_idx on tp_nla_template_items (template_id);

-- ── A cycle ──────────────────────────────────────────────────────────────────
-- The subject must be able to log in to self-assess, so subject_profile_id is a
-- real profile; subject_member_id links back to the roster row when there is one.
create table if not exists tp_nla_assessments (
  id                  uuid primary key default gen_random_uuid(),
  subject_member_id   uuid references tp_team_members(id) on delete set null,
  subject_profile_id  uuid not null references profiles(id) on delete cascade,
  template_id         uuid not null references tp_nla_templates(id),
  target_role         text not null,
  leader_profile_id   uuid not null references profiles(id) on delete cascade,
  store_id            uuid references stores(id) on delete set null,
  district_id         uuid references districts(id) on delete set null,
  status              text not null default 'awaiting_responses',
    -- draft | awaiting_responses | both_submitted | aligned | acknowledged | archived
  opened_at           timestamptz not null default now(),
  comparison_ready_at timestamptz,
  acknowledged_at     timestamptz,
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists tp_nla_assess_subject_idx on tp_nla_assessments (subject_profile_id);
create index if not exists tp_nla_assess_leader_idx  on tp_nla_assessments (leader_profile_id);
create index if not exists tp_nla_assess_store_idx   on tp_nla_assessments (store_id);

create table if not exists tp_nla_responses (
  id               uuid primary key default gen_random_uuid(),
  assessment_id    uuid not null references tp_nla_assessments(id) on delete cascade,
  rater_profile_id uuid not null references profiles(id) on delete cascade,
  rater_type       text not null,                -- self | leader | second_level
  submitted_at     timestamptz,
  locked           boolean not null default false,
  created_at       timestamptz not null default now()
);
create unique index if not exists tp_nla_resp_unique on tp_nla_responses (assessment_id, rater_type);
create index if not exists tp_nla_resp_assess_idx on tp_nla_responses (assessment_id);

create table if not exists tp_nla_ratings (
  id               uuid primary key default gen_random_uuid(),
  assessment_id    uuid not null references tp_nla_assessments(id) on delete cascade,
  response_id      uuid not null references tp_nla_responses(id) on delete cascade,
  template_item_id uuid not null references tp_nla_template_items(id),
  competency_key   text not null,
  rating           text not null,                -- M | A | O
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists tp_nla_rating_unique on tp_nla_ratings (response_id, template_item_id);
create index if not exists tp_nla_rating_assess_idx on tp_nla_ratings (assessment_id);

-- ── Comparison view (self vs leader per competency) ──────────────────────────
-- M=3, A=2, O=1; delta = self − leader → >0 blind_spot, <0 confidence_gap,
-- 0 aligned. Consumed only by the service-role function.
create or replace view tp_nla_comparison as
with r as (
  select rt.assessment_id, rt.competency_key,
         max(case when rp.rater_type = 'self'   then rt.rating end) as self_rating,
         max(case when rp.rater_type = 'leader' then rt.rating end) as leader_rating
  from tp_nla_ratings rt
  join tp_nla_responses rp on rp.id = rt.response_id
  group by rt.assessment_id, rt.competency_key
)
select
  r.assessment_id, r.competency_key, r.self_rating, r.leader_rating,
  case when r.self_rating is null or r.leader_rating is null then null
    else (case r.self_rating   when 'M' then 3 when 'A' then 2 else 1 end)
       - (case r.leader_rating when 'M' then 3 when 'A' then 2 else 1 end)
  end as delta,
  case
    when r.self_rating is null or r.leader_rating is null then 'incomplete'
    when r.self_rating = r.leader_rating then 'aligned'
    when (case r.self_rating   when 'M' then 3 when 'A' then 2 else 1 end)
       > (case r.leader_rating when 'M' then 3 when 'A' then 2 else 1 end) then 'blind_spot'
    else 'confidence_gap'
  end as gap_type
from r;

-- ── Immutability triggers ────────────────────────────────────────────────────
-- Once a response is locked, its ratings can't change or be deleted.
create or replace function tp_nla_ratings_lock_guard() returns trigger language plpgsql as $$
declare is_locked boolean;
begin
  select locked into is_locked from tp_nla_responses
    where id = coalesce(new.response_id, old.response_id);
  if is_locked then
    raise exception 'NLA ratings are locked and cannot be modified';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists tp_nla_ratings_lock on tp_nla_ratings;
create trigger tp_nla_ratings_lock before update or delete on tp_nla_ratings
  for each row execute function tp_nla_ratings_lock_guard();

-- A locked response can't be reopened or its submission time rewritten.
create or replace function tp_nla_response_lock_guard() returns trigger language plpgsql as $$
begin
  if old.locked and (new.locked = false or new.submitted_at is distinct from old.submitted_at) then
    raise exception 'NLA response is locked and cannot be reopened';
  end if;
  return new;
end $$;
drop trigger if exists tp_nla_response_lock on tp_nla_responses;
create trigger tp_nla_response_lock before update on tp_nla_responses
  for each row execute function tp_nla_response_lock_guard();

-- Touch updated_at on ratings (reuses the team-pipeline helper).
drop trigger if exists tp_nla_ratings_touch on tp_nla_ratings;
create trigger tp_nla_ratings_touch before update on tp_nla_ratings
  for each row execute function tp_touch_updated_at();

alter table tp_nla_templates      enable row level security;
alter table tp_nla_template_items enable row level security;
alter table tp_nla_assessments    enable row level security;
alter table tp_nla_responses      enable row level security;
alter table tp_nla_ratings        enable row level security;

-- ── Seed: Shift Manager → Assistant GM, v1 (16 competencies) ─────────────────
-- target_role 'fam' = First Assistant Manager (our ladder's Assistant-GM rung).
insert into tp_nla_templates (target_role, version, title, status, effective_date)
values ('fam', 1, 'Shift Manager → Assistant General Manager', 'active', current_date)
on conflict (target_role, version) do nothing;

insert into tp_nla_template_items (template_id, category, sort_order, competency_key, name, description, example)
select t.id, v.category, v.sort_order, v.competency_key, v.name, v.description, v.example
from tp_nla_templates t
cross join (values
  ('Brand Purpose', 1, 'listen', 'Attentive Listening',
    'Gives people full attention; paraphrases and repeats things back to ensure understanding; lets people finish before responding or asking questions.',
    'Pays attention to what is being said; listens until the speaker finishes, then responds; maintains appropriate body language.'),
  ('Brand Purpose', 2, 'respect', 'Respectful Communication',
    'All communication is professional and respectful, no hidden agendas; keeps others informed to build an engaging working environment.',
    'Keeps management and team well informed; is open and honest; presents professionally at all times.'),
  ('Brand Purpose', 3, 'team', 'Teamwork',
    'Treats people with respect, keeps a positive attitude, makes work fun; recognizes team members and works cross-functionally to hit objectives.',
    'Recognizes team members for accomplishments; creates positive morale; participates in meetings.'),
  ('Leadership', 4, 'inspire', 'Inspiring Others',
    'Emphasizes the importance of people''s contributions; ties work to their personal/career goals, interests, and brand values.',
    'Relates well to people; prioritizes team and guest service; assists team with setting and achieving goals.'),
  ('Leadership', 5, 'manageperf', 'Managing Performance',
    'Monitors performance and metrics; gives in-the-moment and end-of-shift feedback.',
    'Completes appraisals on time with specific examples; sets goals during the shift and follows up after.'),
  ('Leadership', 6, 'conflict', 'Resolves Conflict',
    'Addresses conflict before it escalates; helps people find common ground and mutually agreeable solutions; values differences.',
    'Addresses conflict as it arises; doesn''t ignore warning signs; maintains composure.'),
  ('Leadership', 7, 'collab', 'Collaborates with Others',
    'Works well with others; listens to opposing viewpoints; stays composed.',
    'Supports different teams across the floor; holds self and team to be team players.'),
  ('Gets Results', 8, 'decision', 'Decision Making',
    'Bases decisions on a systematic review of the facts; avoids assumptions, emotional decisions, or rushing to judgment; gives clear rationale.',
    'Makes good decisions in a timely manner; effectively reviews facts; knows when to ask for guidance.'),
  ('Gets Results', 9, 'accept', 'Accepting Responsibility',
    'Takes accountability for commitments; owns mistakes and uses them to learn; openly discusses actions and consequences, good and bad.',
    'Accepts accountability for team results; celebrates successes and works to improve opportunities.'),
  ('Innovates', 10, 'initiative', 'Demonstrates Initiative',
    'Acts without being prompted; handles problems independently; does more than is expected or asked.',
    'Seeks and uses feedback to improve; has a passion for learning; actively works on team improvement.'),
  ('Innovates', 11, 'problem', 'Problem Solving',
    'Breaks large problems into manageable parts; identifies the factors that influence each solution; clarifies what''s needed to solve them.',
    'Attentive to details; identifies potential solutions; keeps working until the problem is solved.'),
  ('Builds Talent', 12, 'delegate', 'Delegation',
    'Gives clear objectives and lets people own their goals; assigns tasks that challenge but don''t overwhelm; acts as a resource by development level.',
    'Provides clear direction; monitors progress and offers timely feedback.'),
  ('Builds Talent', 13, 'develop', 'Develops Talent',
    'Invests time in building capabilities; helps people define career goals and development plans; gives constructive, developmental feedback.',
    'Takes initiative with team training; ensures proper training happens during the shift.'),
  ('Technical Skills', 14, 'ops', 'Operations Knowledge',
    'Supports the AGM/GM in procedure execution; holds the team accountable for maintaining standards at a high level.',
    ''),
  ('Technical Skills', 15, 'pl', 'P&L Knowledge',
    'Understands the biggest drivers in food and bar costs; can speak to the sales budget and MCI; schedules effectively to manage labor.',
    ''),
  ('Technical Skills', 16, 'training', 'Training Execution',
    'Supports the training program; ensures team members complete proper training; keeps training materials and job aids current.',
    '')
) as v(category, sort_order, competency_key, name, description, example)
where t.target_role = 'fam' and t.version = 1
on conflict (template_id, competency_key) do nothing;

notify pgrst, 'reload schema';
