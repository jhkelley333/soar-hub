-- supabase/migrations/0118_labor_sync_state.sql
--
-- Labor sync state — change-detection for the polling snapshot.
--
-- The labor Google Sheet is filled by back office at different times
-- throughout the day, with no single "done" moment. Rather than fire one
-- nightly capture (which risks snapshotting half-filled data), the
-- labor-snapshot function polls on a short interval and re-pulls whenever
-- the sheet's content has changed for the current business date. The
-- upsert into labor_daily_snapshots is idempotent on (store_id,
-- business_date), so repeated pulls converge to the final numbers.
--
-- This table records, per business_date, a hash of the last-captured grid
-- plus bookkeeping, so a poll that finds no change can skip the heavy
-- upsert (cheap read, no write). One row per business_date.
--
-- RLS: service-role only, same as the rest of the Labor module.
--
-- Idempotent.

create table if not exists labor_sync_state (
  business_date   date         primary key,
  content_hash    text         not null,        -- sha256 of the normalized data rows
  rows_captured   integer      not null default 0,
  stores_matched  integer      not null default 0,
  stores_orphaned integer      not null default 0,
  poll_count      integer      not null default 0,   -- total polls seen for this date
  change_count    integer      not null default 0,   -- times the hash actually changed
  last_polled_at  timestamptz  not null default now(),
  last_changed_at timestamptz  not null default now(),
  created_at      timestamptz  not null default now()
);

create index if not exists labor_sync_state_last_changed_idx
  on labor_sync_state (last_changed_at desc);

alter table labor_sync_state enable row level security;
-- (No policies — service role only, like labor_daily_snapshots.)
