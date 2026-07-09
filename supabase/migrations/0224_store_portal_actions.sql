-- 0224_store_portal_actions.sql
-- Action items for the Store Command Center day sheet: GM and above set them
-- per store (from the dashboard message board), and the store screen checks
-- them off. Service-role gatekeeper pattern: RLS on, no policies -- the
-- store-portal function scope-checks every call. Pure ASCII.

create table if not exists store_portal_actions (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  title       text not null,
  due_label   text,
  assignee    text,
  done        boolean not null default false,
  done_at     timestamptz,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists store_portal_actions_store_idx
  on store_portal_actions (store_id, done, created_at desc);

alter table store_portal_actions enable row level security;

notify pgrst, 'reload schema';
