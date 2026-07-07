-- 0214_tp_dev_plans.sql
-- Partner Development Plans (PDP) for Team Pipeline — a career development map
-- per roster member, modeled on Sonic's PDP template (Behavior/Skill → Goal →
-- Development Activities → Date → Progress) with Starbucks' coaching cues
-- (specific skills over "get promoted", the 70/20/10 experience mix, progress
-- notes before each development conversation). One active plan per member: a
-- header (future/target role + target date) plus ranked development items.

create table if not exists tp_dev_plans (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references tp_team_members(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  target_role  text,                              -- future role aspiration
  target_date  date,                              -- when they'd be ready
  status       text not null default 'active',    -- active | archived
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- One active plan per member (archived plans kept for history).
create unique index if not exists tp_dev_plans_active_member
  on tp_dev_plans (member_id) where status = 'active';

create table if not exists tp_dev_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references tp_dev_plans(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  focus_area   text not null,                     -- Behavior/Skill / focus area
  goal         text,                              -- measurable goal statement
  actions      text,                              -- development activities (70/20/10)
  target_date  date,
  progress     text,                              -- progress / conversation notes
  status       text not null default 'open',      -- open | in_progress | done
  rank         int  not null default 0,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tp_dev_items_plan_idx on tp_dev_items (plan_id);
create index if not exists tp_dev_items_store_idx on tp_dev_items (store_id);

-- Service-role gatekeeper: RLS on, no policies — the function scope-checks.
alter table tp_dev_plans enable row level security;
alter table tp_dev_items enable row level security;

notify pgrst, 'reload schema';
