-- supabase/migrations/0008_org_changes_audit.sql
--
-- Phase 2c: audit log for Org Admin (regions / markets / districts / stores).
--
-- Mirrors team_changes (0005) but for the org tree instead of profiles. Kept
-- as a separate table so target_id can be a polymorphic reference without
-- breaking the team_changes FK to profiles(id).
--
-- target_kind tells you which table target_id points at. We store the kind
-- as a string (not an FK) because the row may have been hard-deleted; the
-- audit trail must survive even if the original row is gone.
--
-- before / after are jsonb partial diffs (same convention as team_changes):
--   create     -> before null, after = provisioned fields
--   update     -> both partials, only changed fields
--   move       -> e.g. { district_id: <old> } / { district_id: <new> }
--   deactivate -> before { is_active: true }, after { is_active: false }
--   reactivate -> inverse
--
-- Reads gated server-side via a future netlify/functions/org-mgmt.js. Direct
-- table SELECT is admin-only via the RLS policy at the bottom.

create type org_target_kind as enum (
  'region',
  'market',  -- becomes 'area' label in UI; renamed in 0009 only if cheap
  'district',
  'store'
);

create type org_change_action as enum (
  'create',
  'update',
  'move',
  'deactivate',
  'reactivate'
);

create table org_changes (
  id          uuid              primary key default uuid_generate_v4(),
  actor_id    uuid              not null references profiles(id) on delete restrict,
  target_kind org_target_kind   not null,
  target_id   uuid              not null,
  action      org_change_action not null,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz       not null default now()
);

create index org_changes_target_idx     on org_changes (target_kind, target_id);
create index org_changes_actor_id_idx   on org_changes (actor_id);
create index org_changes_created_at_idx on org_changes (created_at desc);

alter table org_changes enable row level security;

create policy org_changes_admin_select on org_changes
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

comment on table org_changes is
  'Phase 2c: audit trail for Org Admin tree (regions/markets/districts/stores). Read via netlify/functions/org-mgmt?action=history; direct SELECT is admin-only.';
