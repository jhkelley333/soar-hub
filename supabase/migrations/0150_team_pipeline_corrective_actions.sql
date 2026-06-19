-- 0150_team_pipeline_corrective_actions.sql
-- Corrective-action documents (progressive discipline) recorded against a
-- roster member: verbal → written → final written → PIP. Service-role only
-- (RLS on, no policies); the team-pipeline function scopes every read/write
-- to the caller's stores. store_id is denormalized off the member so the
-- scope check is a single lookup (mirrors tp_requisitions).

create table if not exists tp_corrective_actions (
  id               uuid primary key default gen_random_uuid(),
  team_member_id   uuid not null references tp_team_members(id) on delete cascade,
  store_id         uuid not null references stores(id) on delete cascade,
  level            text not null,                    -- verbal | written | final | pip
  category         text,                             -- attendance | performance | conduct | policy | safety
  incident_date    date,
  summary          text not null,                    -- what happened
  expectations     text,                             -- what must change
  consequence      text,                             -- what happens if it recurs
  status           text not null default 'active',   -- active | acknowledged | closed
  issued_by        text,
  issued_by_id     uuid references profiles(id) on delete set null,
  acknowledged_at  timestamptz,
  acknowledged_by  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists tp_ca_member_idx on tp_corrective_actions (team_member_id);
create index if not exists tp_ca_store_idx  on tp_corrective_actions (store_id);
alter table tp_corrective_actions enable row level security;

-- reuse the touch trigger defined in 0148
drop trigger if exists tp_ca_touch on tp_corrective_actions;
create trigger tp_ca_touch before update on tp_corrective_actions
  for each row execute function tp_touch_updated_at();
