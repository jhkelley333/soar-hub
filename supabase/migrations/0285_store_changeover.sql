-- 0285_store_changeover.sql
-- Store changeover checklists: SDO/RVP run the DO changeover, DOs run the GM
-- changeover, each assigned to a store (and optionally to a Hub user who can
-- also work it). Item state lives in `progress` (jsonb keyed by item key). The
-- checklist templates themselves live in the app, not the DB. Service-role
-- gatekeeper: RLS on, no policies; the function enforces role + scope.

create table if not exists changeover_checklists (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('do', 'gm')),   -- which template
  store_id      uuid references stores(id) on delete set null,
  store_number  text,
  store_name    text,
  outgoing_name text,                                          -- previous DO / outgoing GM
  incoming_name text,                                          -- new DO / new GM
  assigned_to   uuid references profiles(id) on delete set null,
  status        text not null default 'open' check (status in ('open', 'in_progress', 'complete')),
  notes         text,
  -- { item_key: { checked: bool, checked_at: iso, checked_by: uuid, note: text } }
  progress      jsonb not null default '{}'::jsonb,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists changeover_store_idx    on changeover_checklists (store_number);
create index if not exists changeover_assigned_idx on changeover_checklists (assigned_to);
create index if not exists changeover_creator_idx  on changeover_checklists (created_by);

alter table changeover_checklists enable row level security;

notify pgrst, 'reload schema';
