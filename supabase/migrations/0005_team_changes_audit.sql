-- supabase/migrations/0005_team_changes_audit.sql
--
-- Phase 2b — audit log for the My Team module.
--
-- Every successful add-user / update-user / deactivate / reactivate from
-- netlify/functions/team-mgmt.js writes one row here so we can answer:
--   "Who changed Joe's role from gm to do, and when?"
--   "Who deactivated Sarah?"
--   "What's the most recent change to this user?"
--
-- The actor is the manager who initiated the change (resolved from the
-- Supabase JWT). Actor cannot be deleted while their audit rows remain
-- (FK ON DELETE RESTRICT) — we'd rather force a manual reassignment than
-- silently lose the trail.
--
-- before/after columns are jsonb capturing only the FIELDS THAT CHANGED.
-- For 'create' there is no before; for 'deactivate'/'reactivate' before
-- and after carry { is_active: ... }.
--
-- Reads gated server-side via team-mgmt.js (?action=history). Direct table
-- access is admin-only via RLS at the bottom of this migration.

create type team_change_action as enum (
  'create',
  'update',
  'deactivate',
  'reactivate'
);

create table team_changes (
  id          uuid              primary key default uuid_generate_v4(),
  actor_id    uuid              not null references profiles(id) on delete restrict,
  target_id   uuid              not null references profiles(id) on delete cascade,
  action      team_change_action not null,
  -- jsonb of changed fields. for 'create' before is null and after is the
  -- snapshot of provisioned fields. for 'update' both are partial diffs.
  before      jsonb,
  after       jsonb,
  created_at  timestamptz       not null default now()
);

create index team_changes_target_id_idx  on team_changes (target_id);
create index team_changes_actor_id_idx   on team_changes (actor_id);
create index team_changes_created_at_idx on team_changes (created_at desc);

-- RLS: only admins can read directly. The team-mgmt function uses the
-- service-role key and bypasses RLS so it can apply its own scope rules
-- (managers can only read history of users in their reach).
alter table team_changes enable row level security;

create policy team_changes_admin_select on team_changes
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

comment on table team_changes is
  'Phase 2b: audit trail for My Team add/update/deactivate/reactivate. Read via netlify/functions/team-mgmt?action=history; direct SELECT is admin-only.';
