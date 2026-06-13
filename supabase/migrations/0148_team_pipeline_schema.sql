-- 0148_team_pipeline_schema.sql
-- Team Pipeline (Talent Planning) data layer.
--
-- Team members are the store ROSTER (Carhop → GM). They are NOT app accounts:
-- most never log in, and they're sourced in bulk from the ATS. `profile_id`
-- links a roster member to a SOAR profile when they also have an app login
-- (e.g. the GM). `external_id` is the ATS id, used to dedupe on re-import.
--
-- RLS is enabled with no policies: all access is via the service-role
-- team-pipeline function, which scopes every read/write to the caller's stores.

-- ladder role keys: carhop | crew | lead | shift | assoc | fam | gm
create table if not exists tp_team_members (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  profile_id    uuid references profiles(id) on delete set null,
  external_id   text,                       -- ATS id (dedupe key on import)
  full_name     text not null,
  role          text not null,              -- ladder key
  email         text,
  phone         text,
  status        text not null default 'active',   -- active | loa
  hire_date     date,
  -- talent overlay (ours, not the ATS's)
  flight_risk   text not null default 'na',        -- na | low | medium | immediate
  risk_reasons  text[] not null default '{}',
  aspiration    text not null default 'current',   -- current | next | looking
  perf          int,                                -- 1..5
  potential     int,                                -- 1..5
  comment       text,
  comment_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tp_team_members_store_idx on tp_team_members (store_id);
create index if not exists tp_team_members_role_idx  on tp_team_members (role);
create unique index if not exists tp_team_members_ext_idx
  on tp_team_members (external_id) where external_id is not null;
alter table tp_team_members enable row level security;

-- talent note thread per roster member
create table if not exists tp_notes (
  id              uuid primary key default gen_random_uuid(),
  team_member_id  uuid not null references tp_team_members(id) on delete cascade,
  body            text not null,
  author          text,
  author_id       uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists tp_notes_member_idx on tp_notes (team_member_id);
alter table tp_notes enable row level security;

-- open requisitions (hiring / backfill)
create table if not exists tp_requisitions (
  id            uuid primary key default gen_random_uuid(),
  ref           text,                       -- human REQ-id, e.g. REQ-3041
  store_id      uuid not null references stores(id) on delete cascade,
  role          text not null,              -- ladder key
  reason        text,
  status        text not null default 'sourcing',  -- sourcing | interviewing | offer | filled
  candidates    int not null default 0,
  opened_by     text,
  opened_by_id  uuid references profiles(id) on delete set null,
  filled_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tp_requisitions_store_idx on tp_requisitions (store_id);
alter table tp_requisitions enable row level security;

-- touch updated_at
create or replace function tp_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists tp_team_members_touch on tp_team_members;
create trigger tp_team_members_touch before update on tp_team_members
  for each row execute function tp_touch_updated_at();
drop trigger if exists tp_requisitions_touch on tp_requisitions;
create trigger tp_requisitions_touch before update on tp_requisitions
  for each row execute function tp_touch_updated_at();
