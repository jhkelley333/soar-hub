-- 0321_labor_daily_store_hours.sql
-- Capture the store's daily operating timestamps from the Skunkworks feed:
-- first/last ticket and first clock-in / last clock-out. Stored as naive
-- timestamps (the feed gives local wall-clock times without an offset, and a
-- last clock-out can cross midnight), so the value is preserved exactly and
-- store-hours math (last_clock_out - first_clock_in) works. Daily-band only.

alter table public.labor_v2_daily
  add column if not exists first_ticket    timestamp,
  add column if not exists last_ticket     timestamp,
  add column if not exists first_clock_in  timestamp,
  add column if not exists last_clock_out  timestamp;

notify pgrst, 'reload schema';
