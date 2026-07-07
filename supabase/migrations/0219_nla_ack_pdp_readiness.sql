-- 0219_nla_ack_pdp_readiness.sql
-- NLA Phase 4: immutable dual acknowledgement, PDP milestones (extending the
-- existing tp_dev_items), and the readiness snapshot that feeds the pipeline.
-- Service-role gatekeeper: RLS on, no policies - the nla function scope-checks.
-- Pure ASCII, minimal string literals (paste-safe).

-- Acknowledgements: insert-only. A trigger blocks update/delete so a signed
-- assessment is a permanent record.
create table if not exists tp_nla_acks (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references tp_nla_assessments(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  ack_role        text not null,               -- team_member | first_level | second_level
  acknowledged_at timestamptz not null default now()
);
create unique index if not exists tp_nla_acks_unique on tp_nla_acks (assessment_id, user_id);
create index if not exists tp_nla_acks_assess_idx on tp_nla_acks (assessment_id);

create or replace function tp_nla_acks_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'NLA acknowledgements are immutable';
end $$;
drop trigger if exists tp_nla_acks_no_change on tp_nla_acks;
create trigger tp_nla_acks_no_change before update or delete on tp_nla_acks
  for each row execute function tp_nla_acks_immutable();

alter table tp_nla_acks enable row level security;

-- PDP milestones: the Day 30/60/90 steps under a development goal (tp_dev_items).
-- Extends the existing 2-tier PDP into plan -> goal -> milestone.
create table if not exists tp_dev_milestones (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references tp_dev_items(id) on delete cascade,
  store_id         uuid references stores(id) on delete set null,
  title            text not null,
  description      text,
  due_date         date,
  owner_profile_id uuid references profiles(id) on delete set null,
  status           text not null default 'not_started',  -- not_started | in_progress | done | blocked
  resource_link    text,
  completed_at     timestamptz,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists tp_dev_milestones_item_idx on tp_dev_milestones (item_id);
create index if not exists tp_dev_milestones_store_idx on tp_dev_milestones (store_id);

drop trigger if exists tp_dev_milestones_touch on tp_dev_milestones;
create trigger tp_dev_milestones_touch before update on tp_dev_milestones
  for each row execute function tp_touch_updated_at();

alter table tp_dev_milestones enable row level security;

-- Readiness snapshot: written on acknowledgement, read by the 9-box / succession
-- views (Phase 6). summary jsonb holds M/A/O + gap counts + focus areas.
create table if not exists tp_readiness_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  subject_member_id    uuid references tp_team_members(id) on delete set null,
  subject_profile_id   uuid references profiles(id) on delete set null,
  source_assessment_id uuid references tp_nla_assessments(id) on delete set null,
  target_role          text,
  summary              jsonb,
  readiness_band       text,                   -- ready_now | ready_soon | developing
  snapshot_date        date not null default current_date,
  created_at           timestamptz not null default now()
);
create index if not exists tp_readiness_subject_idx on tp_readiness_snapshots (subject_member_id);
create index if not exists tp_readiness_assess_idx on tp_readiness_snapshots (source_assessment_id);

alter table tp_readiness_snapshots enable row level security;

notify pgrst, 'reload schema';
