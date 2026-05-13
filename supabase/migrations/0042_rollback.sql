-- supabase/migrations/0042_rollback.sql
--
-- Rollback for 0042_status_v2_and_activities.sql.
--
-- Recovers the pre-migration shape: text `status` column on tickets,
-- `ticket_updates` table without the new columns, no enum types.
--
-- Cost: activity entries written between the forward migration and
-- this rollback are preserved (still in ticket_updates after the
-- rename-back) but the new event_type / event_data / visibility
-- columns are dropped, so any structured data they captured is lost.
-- Acceptable per design doc §4 (activity entries are diagnostic, not
-- financial). The `migrated` entries inserted by the forward migration
-- are deleted explicitly so a re-run of the forward migration won't
-- duplicate them.
--
-- Order is important: drop the renamed-back tables BEFORE dropping
-- types, otherwise the enum drop fails (still referenced).

-- ── Remove migration-generated activity entries ──
delete from ticket_activities
where event_type = 'migrated'
  and (event_data->>'legacy')::boolean is true;

-- ── ticket_activities → ticket_updates ──
alter table ticket_activities drop column if exists visibility;
alter table ticket_activities drop column if exists event_data;
alter table ticket_activities drop column if exists event_type;

do $$ begin
  if exists (select 1 from pg_class where relname = 'ticket_activities') then
    alter table ticket_activities rename to ticket_updates;
  end if;
end $$;

-- ── tickets: convert status enum back to text ──
alter table tickets add column if not exists status_text text;

update tickets set status_text = case status::text
  when 'submitted'   then coalesce(status_legacy_text, 'Received')
  when 'in_progress' then coalesce(
    case pause_state::text
      when 'on_hold'              then 'On Hold'
      when 'awaiting_parts'       then 'Part on Order'
      when 'awaiting_replacement' then 'New Equipment Ordered'
      else null
    end,
    status_legacy_text,
    'In Progress')
  when 'scheduled'   then coalesce(status_legacy_text, 'Scheduled')
  when 'on_site'     then 'In Progress'   -- no legacy equivalent
  when 'completed'   then 'Closed'        -- no legacy equivalent
  when 'closed'      then coalesce(status_legacy_text, 'Closed')
  when 'cancelled'   then 'Closed'        -- no legacy equivalent
  else coalesce(status_legacy_text, 'Received')
end;

alter table tickets drop column status;
alter table tickets drop column if exists status_legacy_text;
alter table tickets rename column status_text to status;
alter table tickets alter column status set default 'Received';
alter table tickets alter column status set not null;

-- Drop the rest of the new columns added by 0042.
alter table tickets drop column if exists closed_at;
alter table tickets drop column if exists completed_at;
alter table tickets drop column if exists related_to;
alter table tickets drop column if exists callback_of;
alter table tickets drop column if exists closed_by_store;
alter table tickets drop column if exists admin_close_reason;
alter table tickets drop column if exists store_close_reason;
alter table tickets drop column if exists resolution_category;
alter table tickets drop column if exists pause_reason_note;
alter table tickets drop column if exists pause_state;

-- Drop indexes added by 0042 (tickets indexes referenced status enum
-- column — already implicitly dropped by drop column above, but the
-- ticket_activities one is named explicitly).
drop index if exists idx_ticket_activities_ticket_created;
drop index if exists idx_tickets_callback_of;
drop index if exists idx_tickets_store_status;

-- ── Enum types (drop last; safe now that no columns reference them) ──
drop type if exists resolution_category_enum;
drop type if exists reopen_reason_enum;
drop type if exists admin_close_reason_enum;
drop type if exists store_close_reason_enum;
drop type if exists pause_state_enum;
drop type if exists ticket_status_v2;

notify pgrst, 'reload schema';
