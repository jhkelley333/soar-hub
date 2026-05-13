-- supabase/migrations/0042_status_v2_and_activities.sql
--
-- Phase 1 of v2 Store & Org User Enhancements.
--
-- Changes (forward):
--   1. New enum types for status / pause / reasons / resolution.
--   2. Add new columns to tickets (status as enum, pause_state, reason
--      codes, callback_of, related_to, completed_at, closed_at).
--   3. Backfill the new status + pause_state from the old text status,
--      using the mapping agreed in design doc §4. Historical "Closed"
--      tickets get resolution_category = 'migrated_unknown' so reporting
--      can default-exclude them.
--   4. Rename old `status text` → `status_legacy_text` (kept for one
--      release; dropped in the PR-3 cleanup).
--   5. Rename `ticket_updates` → `ticket_activities` and extend with
--      event_type / event_data / visibility columns. Backfill existing
--      rows into the new shape. Drop the temporary default on event_type
--      so going forward writers must pass it explicitly.
--   6. Write one `migrated` activity entry per backfilled "closed"
--      ticket so the timeline preserves provenance.
--   7. Indexes from design doc §3.
--
-- Rollback: see 0042_rollback.sql in the same directory. Tested
-- against a copy of production data before merge.
--
-- Run with: paste the whole file into Supabase v2 SQL editor and click
-- RUN. The editor wraps multi-statement scripts in a single transaction.

-- ─────────────────────────────────────────────────────────────
-- 1. Enum types
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ticket_status_v2') then
    create type ticket_status_v2 as enum (
      'submitted', 'in_progress', 'scheduled', 'on_site',
      'completed', 'closed', 'cancelled'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'pause_state_enum') then
    create type pause_state_enum as enum (
      'none', 'on_hold', 'awaiting_parts', 'awaiting_replacement'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'store_close_reason_enum') then
    create type store_close_reason_enum as enum (
      'user_error', 'resolved_internally', 'duplicate', 'no_longer_needed'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'admin_close_reason_enum') then
    create type admin_close_reason_enum as enum (
      'completed_and_verified', 'auto_closed_no_verification',
      'cancelled_by_ops', 'equipment_replaced', 'written_off', 'deferred_to_capex'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'reopen_reason_enum') then
    create type reopen_reason_enum as enum (
      'not_fixed', 'recurred', 'wrong_diagnosis', 'other'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'resolution_category_enum') then
    create type resolution_category_enum as enum (
      'repaired', 'replaced', 'no_issue_found', 'deferred', 'migrated_unknown'
    );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. New columns on `tickets`
--
-- All added as nullable first so the backfill can run; status and
-- pause_state get NOT NULL + default after backfill below.
-- ─────────────────────────────────────────────────────────────

alter table tickets
  add column if not exists status_new          ticket_status_v2,
  add column if not exists pause_state         pause_state_enum,
  add column if not exists pause_reason_note   text,
  add column if not exists resolution_category resolution_category_enum,
  add column if not exists store_close_reason  store_close_reason_enum,
  add column if not exists admin_close_reason  admin_close_reason_enum,
  add column if not exists closed_by_store     boolean not null default false,
  add column if not exists callback_of         uuid references tickets(id) on delete set null,
  add column if not exists related_to          uuid references tickets(id) on delete set null,
  add column if not exists completed_at        timestamptz,
  add column if not exists closed_at           timestamptz;

-- ─────────────────────────────────────────────────────────────
-- 3. Backfill new columns from old `status` (text)
-- ─────────────────────────────────────────────────────────────

update tickets set
  status_new = case status
    when 'Received'              then 'submitted'::ticket_status_v2
    when 'Pending Approval'      then 'submitted'::ticket_status_v2
    when 'Approved'              then 'submitted'::ticket_status_v2
    when 'Rejected - See Notes'  then 'submitted'::ticket_status_v2
    when 'Scheduled'             then 'scheduled'::ticket_status_v2
    when 'In Progress'           then 'in_progress'::ticket_status_v2
    when 'On Hold'               then 'in_progress'::ticket_status_v2
    when 'Part on Order'         then 'in_progress'::ticket_status_v2
    when 'New Equipment Ordered' then 'in_progress'::ticket_status_v2
    when 'Closed'                then 'closed'::ticket_status_v2
    when 'Cancelled'             then 'cancelled'::ticket_status_v2
    else 'submitted'::ticket_status_v2  -- unknown legacy values default to submitted
  end,
  pause_state = case status
    when 'On Hold'               then 'on_hold'::pause_state_enum
    when 'Part on Order'         then 'awaiting_parts'::pause_state_enum
    when 'New Equipment Ordered' then 'awaiting_replacement'::pause_state_enum
    else 'none'::pause_state_enum
  end,
  resolution_category = case status
    when 'Closed' then 'migrated_unknown'::resolution_category_enum
    else null
  end,
  closed_at = case status
    when 'Closed' then coalesce(date_completed, updated_at)
    else null
  end
where status_new is null;  -- idempotent: only fill rows we haven't seen

-- Promote the new status column to canonical.
alter table tickets rename column status to status_legacy_text;
alter table tickets rename column status_new to status;
alter table tickets alter column status set not null;
alter table tickets alter column status set default 'submitted'::ticket_status_v2;
alter table tickets alter column pause_state set not null;
alter table tickets alter column pause_state set default 'none'::pause_state_enum;

-- ─────────────────────────────────────────────────────────────
-- 4. Rename + extend ticket_updates → ticket_activities
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if exists (select 1 from pg_class where relname = 'ticket_updates') then
    alter table ticket_updates rename to ticket_activities;
  end if;
end $$;

alter table ticket_activities
  add column if not exists event_type text,
  add column if not exists event_data jsonb not null default '{}',
  add column if not exists visibility text not null default 'all';

-- Backfill event_type + event_data on existing legacy rows.
update ticket_activities set
  event_type = coalesce(update_type, 'legacy_update'),
  event_data = jsonb_strip_nulls(jsonb_build_object(
    'old_value', old_value,
    'new_value', new_value,
    'notes',     notes,
    'legacy',    true
  ))
where event_type is null or event_data = '{}'::jsonb;

alter table ticket_activities alter column event_type set not null;

-- One `migrated` activity entry per backfilled-closed ticket so the
-- timeline shows where the old data came from. Skipped if already
-- present (re-run safety). update_type is populated alongside the
-- new event_type — the legacy column still carries a NOT NULL
-- constraint for one release cycle.
insert into ticket_activities (ticket_id, event_type, event_data, visibility, created_at, update_type)
select t.id,
       'migrated',
       jsonb_build_object('migrated_from', t.status_legacy_text, 'legacy', true),
       'all',
       now(),
       'migrated'
from tickets t
where t.status = 'closed'
  and t.resolution_category = 'migrated_unknown'
  and not exists (
    select 1 from ticket_activities a
    where a.ticket_id = t.id and a.event_type = 'migrated'
  );

-- ─────────────────────────────────────────────────────────────
-- 5. Indexes
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_ticket_activities_ticket_created
  on ticket_activities(ticket_id, created_at desc);

create index if not exists idx_tickets_store_status
  on tickets(store_number, status, updated_at desc);

create index if not exists idx_tickets_callback_of
  on tickets(callback_of) where callback_of is not null;

notify pgrst, 'reload schema';
