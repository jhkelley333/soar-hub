-- 0140_schedule_event_recurrence.sql
-- Recurrence for native schedule events. A single master row repeats on a
-- fixed cadence; the backend expands occurrences within the queried window.
-- v1 cadences: daily, weekly, biweekly, monthly. `recurrence_until` (date,
-- inclusive) optionally caps the series; null means open-ended (the backend
-- still only ever projects into the visible window, with a safety cap).

alter table public.schedule_events
  add column if not exists recurrence text not null default 'none',
  add column if not exists recurrence_until date;

-- Guardrail: only the cadences the expander understands.
alter table public.schedule_events
  drop constraint if exists schedule_events_recurrence_chk;
alter table public.schedule_events
  add constraint schedule_events_recurrence_chk
  check (recurrence in ('none','daily','weekly','biweekly','monthly'));

-- Helps the "recurring masters" fetch (everything not 'none').
create index if not exists schedule_events_recurrence_idx
  on public.schedule_events (recurrence)
  where recurrence <> 'none';
