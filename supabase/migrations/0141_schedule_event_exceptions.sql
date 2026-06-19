-- 0141_schedule_event_exceptions.sql
-- Per-occurrence control for recurring schedule events. `recurrence_exceptions`
-- holds occurrence dates (UTC YYYY-MM-DD, matching the expander's keying) that
-- should be SKIPPED — so a single instance can be cancelled without touching
-- the rest of the series. "Delete this & following" is handled separately by
-- capping recurrence_until, and needs no new storage.

alter table public.schedule_events
  add column if not exists recurrence_exceptions text[] not null default '{}';
