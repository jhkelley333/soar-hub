-- supabase/migrations/0043_rollback.sql
--
-- Rolls back 0043_drop_status_legacy.sql. Re-adds the
-- status_legacy_text column to tickets and recomputes a best-effort
-- legacy label from the current (enum, pause_state) pair.
--
-- Lossy in one direction: tickets currently in on_site / completed /
-- cancelled have no exact v1 equivalent, so they get the closest
-- legacy label. Acceptable for an emergency rollback — if you need
-- exact prior values, restore from a backup taken just before the
-- forward migration ran.

alter table tickets add column if not exists status_legacy_text text;

update tickets set status_legacy_text = case status::text
  when 'submitted'   then 'Received'
  when 'in_progress' then case pause_state::text
    when 'on_hold'              then 'On Hold'
    when 'awaiting_parts'       then 'Part on Order'
    when 'awaiting_replacement' then 'New Equipment Ordered'
    else 'In Progress'
  end
  when 'scheduled'   then 'Scheduled'
  when 'on_site'     then 'In Progress'   -- no legacy equivalent
  when 'completed'   then 'Closed'        -- no legacy equivalent
  when 'closed'      then 'Closed'
  when 'cancelled'   then 'Closed'        -- no legacy equivalent
  else 'Received'
end
where status_legacy_text is null;

-- Restore the original flag row (best-effort — original notes lost).
update feature_flags
set enabled = false,
    notes = 'Work Orders v2 Phase 1: status enum migration, pause ' ||
            'state, activity feed, status bar UI. (Restored by ' ||
            '0043_rollback.sql.)'
where key = 'wo2_status_v2';

notify pgrst, 'reload schema';
