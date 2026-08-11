-- 0283_store_hours_history.sql
-- Append-only snapshot log of standard weekly hours, so every change is tracked
-- and hours can be reconstructed for any past date (year-over-year comparison).

-- One row per change: the FULL 7-day standard-hours snapshot at that moment.
-- "Hours as of date D" = the latest row per store with changed_at <= D.
create table if not exists store_hours_history (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  changed_at  timestamptz not null default now(),
  changed_by  uuid references profiles(id),
  source      text,                 -- 'edit' | 'import' | 'baseline'
  days        jsonb not null,       -- [{day_of_week,is_closed,open,close}] snapshot
  note        text
);
create index if not exists store_hours_history_store_time_idx
  on store_hours_history (store_id, changed_at desc);

-- Baseline: capture the current standard hours as the first snapshot, but only
-- if the log is empty (so re-running this migration never double-seeds).
insert into store_hours_history (store_id, changed_at, source, days)
select store_id, now(), 'baseline',
       jsonb_agg(
         jsonb_build_object(
           'day_of_week', day_of_week,
           'is_closed',   is_closed,
           'open',        to_char(open_time,  'HH24:MI'),
           'close',       to_char(close_time, 'HH24:MI')
         ) order by day_of_week)
from store_hours
where not exists (select 1 from store_hours_history)
group by store_id;

notify pgrst, 'reload schema';
