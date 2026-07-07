-- 0217_nla_schema_seed.sql
-- Next Level Assessment (NLA) - Phase 1: the instrument + a cycle + the
-- self-vs-leader comparison view, seeded with the Shift Manager to Assistant GM
-- template v1 (16 competencies). Feeds the PDP + succession loop.
--
-- Access: service-role gatekeeper - RLS on, NO policies. The nla function
-- scope-checks every read/write (same pattern as team-pipeline). Immutability of
-- locked ratings is enforced at the DB via triggers (defense in depth), so a
-- submitted assessment cannot be quietly edited even through the service role.
-- NOTE: this file is intentionally pure ASCII with no apostrophes so it survives
-- copy/paste into any SQL client without quote corruption.

-- Instrument (role-keyed, versioned)
create table if not exists tp_nla_templates (
  id             uuid primary key default gen_random_uuid(),
  target_role    text not null,
  version        int  not null default 1,
  title          text not null,
  status         text not null default 'active',
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
  competency_key  text not null,
  name            text not null,
  description     text,
  example         text
);
create unique index if not exists tp_nla_items_tpl_key on tp_nla_template_items (template_id, competency_key);
create index if not exists tp_nla_items_tpl_idx on tp_nla_template_items (template_id);

-- A cycle. The subject must be able to log in to self-assess, so
-- subject_profile_id is a real profile; subject_member_id links to the roster.
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
  rater_type       text not null,
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
  rating           text not null,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists tp_nla_rating_unique on tp_nla_ratings (response_id, template_item_id);
create index if not exists tp_nla_rating_assess_idx on tp_nla_ratings (assessment_id);

-- Comparison view (self vs leader per competency).
-- M=3, A=2, O=1; delta = self minus leader. gt 0 blind_spot, lt 0 confidence_gap, 0 aligned.
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

-- Immutability triggers. Once a response is locked its ratings cannot change.
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

-- A locked response cannot be reopened or its submission time rewritten.
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

drop trigger if exists tp_nla_ratings_touch on tp_nla_ratings;
create trigger tp_nla_ratings_touch before update on tp_nla_ratings
  for each row execute function tp_touch_updated_at();

alter table tp_nla_templates      enable row level security;
alter table tp_nla_template_items enable row level security;
alter table tp_nla_assessments    enable row level security;
alter table tp_nla_responses      enable row level security;
alter table tp_nla_ratings        enable row level security;

-- Seed: Shift Manager to Assistant GM, v1 (16 competencies).
-- target_role fam = First Assistant Manager, our ladder Assistant-GM rung.
-- All strings are dollar-quoted ($c$...$c$) so there is not a single quote
-- character in the seed - it cannot be corrupted by copy/paste.
insert into tp_nla_templates (target_role, version, title, status, effective_date)
values ($c$fam$c$, 1, $c$Shift Manager to Assistant General Manager$c$, $c$active$c$, current_date)
on conflict (target_role, version) do nothing;

insert into tp_nla_template_items (template_id, category, sort_order, competency_key, name, description, example)
select t.id, v.category, v.sort_order, v.competency_key, v.name, v.description, v.example
from tp_nla_templates t
cross join (values
  ($c$Brand Purpose$c$, 1, $c$listen$c$, $c$Attentive Listening$c$,
    $c$Gives people full attention. Paraphrases and repeats things back to ensure understanding. Lets people finish before responding or asking questions.$c$,
    $c$Pays attention to what is being said. Listens until the speaker finishes, then responds. Maintains appropriate body language.$c$),
  ($c$Brand Purpose$c$, 2, $c$respect$c$, $c$Respectful Communication$c$,
    $c$All communication is professional and respectful, with no hidden agendas. Keeps others informed to build an engaging working environment.$c$,
    $c$Keeps management and team well informed. Is open and honest. Presents professionally at all times.$c$),
  ($c$Brand Purpose$c$, 3, $c$team$c$, $c$Teamwork$c$,
    $c$Treats people with respect, keeps a positive attitude, and makes work fun. Recognizes team members and works cross-functionally to hit objectives.$c$,
    $c$Recognizes team members for accomplishments. Creates positive morale. Participates in meetings.$c$),
  ($c$Leadership$c$, 4, $c$inspire$c$, $c$Inspiring Others$c$,
    $c$Emphasizes the importance of the contributions people make. Ties work to their personal and career goals, interests, and brand values.$c$,
    $c$Relates well to people. Prioritizes team and guest service. Assists team with setting and achieving goals.$c$),
  ($c$Leadership$c$, 5, $c$manageperf$c$, $c$Managing Performance$c$,
    $c$Monitors performance and metrics. Gives in-the-moment and end-of-shift feedback.$c$,
    $c$Completes appraisals on time with specific examples. Sets goals during the shift and follows up after.$c$),
  ($c$Leadership$c$, 6, $c$conflict$c$, $c$Resolves Conflict$c$,
    $c$Addresses conflict before it escalates. Helps people find common ground and mutually agreeable solutions. Values differences.$c$,
    $c$Addresses conflict as it arises. Does not ignore warning signs. Maintains composure.$c$),
  ($c$Leadership$c$, 7, $c$collab$c$, $c$Collaborates with Others$c$,
    $c$Works well with others. Listens to opposing viewpoints. Stays composed.$c$,
    $c$Supports different teams across the floor. Holds self and team to be team players.$c$),
  ($c$Gets Results$c$, 8, $c$decision$c$, $c$Decision Making$c$,
    $c$Bases decisions on a systematic review of the facts. Avoids assumptions, emotional decisions, or rushing to judgment. Gives clear rationale.$c$,
    $c$Makes good decisions in a timely manner. Effectively reviews facts. Knows when to ask for guidance.$c$),
  ($c$Gets Results$c$, 9, $c$accept$c$, $c$Accepting Responsibility$c$,
    $c$Takes accountability for commitments. Owns mistakes and uses them to learn. Openly discusses actions and consequences, good and bad.$c$,
    $c$Accepts accountability for team results. Celebrates successes and works to improve opportunities.$c$),
  ($c$Innovates$c$, 10, $c$initiative$c$, $c$Demonstrates Initiative$c$,
    $c$Acts without being prompted. Handles problems independently. Does more than is expected or asked.$c$,
    $c$Seeks and uses feedback to improve. Has a passion for learning. Actively works on team improvement.$c$),
  ($c$Innovates$c$, 11, $c$problem$c$, $c$Problem Solving$c$,
    $c$Breaks large problems into smaller parts. Identifies the factors that influence each solution. Clarifies what is needed to solve them.$c$,
    $c$Attentive to details. Identifies potential solutions. Keeps working until the problem is solved.$c$),
  ($c$Builds Talent$c$, 12, $c$delegate$c$, $c$Delegation$c$,
    $c$Gives clear objectives and lets people own their goals. Assigns tasks that challenge but do not overwhelm. Acts as a resource by development level.$c$,
    $c$Provides clear direction. Monitors progress and offers timely feedback.$c$),
  ($c$Builds Talent$c$, 13, $c$develop$c$, $c$Develops Talent$c$,
    $c$Invests time in building capabilities. Helps people define career goals and development plans. Gives constructive, developmental feedback.$c$,
    $c$Takes initiative with team training. Ensures proper training happens during the shift.$c$),
  ($c$Technical Skills$c$, 14, $c$ops$c$, $c$Operations Knowledge$c$,
    $c$Supports the AGM or GM in procedure execution. Holds the team accountable for maintaining standards at a high level.$c$,
    null),
  ($c$Technical Skills$c$, 15, $c$pl$c$, $c$P and L Knowledge$c$,
    $c$Understands the biggest drivers in food and bar costs. Can speak to the sales budget and MCI. Schedules effectively to manage labor.$c$,
    null),
  ($c$Technical Skills$c$, 16, $c$training$c$, $c$Training Execution$c$,
    $c$Supports the training program. Ensures team members complete proper training. Keeps training materials and job aids current.$c$,
    null)
) as v(category, sort_order, competency_key, name, description, example)
where t.target_role = $c$fam$c$ and t.version = 1
on conflict (template_id, competency_key) do nothing;

notify pgrst, 'reload schema';
