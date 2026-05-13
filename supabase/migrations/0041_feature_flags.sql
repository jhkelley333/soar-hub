-- supabase/migrations/0041_feature_flags.sql
--
-- Feature-flag table for Work Orders v2 Phase 1 rollout (and any
-- future gated work). Single global toggle per key, plus optional
-- per-store and per-user allowlists for pilot phases.
--
-- Rollout pattern:
--   1. Insert row with enabled=false, allowlist_stores=['1242'].
--      Only the pilot store sees the new behavior.
--   2. Once validated, set enabled=true.
--   3. After cleanup PR, the row can be left in place (no-op) or
--      deleted — the consuming code defaults to "off" when a row is
--      missing.
--
-- Idempotent (create table IF NOT EXISTS, insert ... on conflict do nothing).

create table if not exists feature_flags (
  key                text        primary key,
  enabled            boolean     not null default false,
  allowlist_stores   text[]      not null default '{}',
  allowlist_user_ids uuid[]      not null default '{}',
  notes              text,
  updated_by_id      uuid        references profiles(id) on delete set null,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- Auto-touch updated_at on every change so the admin UI can show
-- "last edited at" without app-side work.
create or replace function feature_flags_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists feature_flags_updated_at on feature_flags;
create trigger feature_flags_updated_at
  before update on feature_flags
  for each row execute function feature_flags_touch_updated_at();

-- Seed the Phase-1 flag in OFF state so PR 1 + PR 2 ship safe.
insert into feature_flags (key, notes) values
  ('wo2_status_v2',
   'Work Orders v2 Phase 1: status enum migration, pause state, activity feed, status bar UI. Gate for both backend (new endpoints, status_legacy in responses) and frontend (new status bar UI). Default OFF until pilot validation completes.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
