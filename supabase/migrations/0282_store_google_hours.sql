-- 0282_store_google_hours.sql
-- Cache each store's Google Places listing + hours so the Hours grid can flag
-- where Google and the system disagree without re-hitting the Places API.

alter table stores
  add column if not exists google_place_id         text,
  add column if not exists google_hours            jsonb,        -- normalized per-day [{day_of_week,is_closed,open,close}]
  add column if not exists google_hours_checked_at timestamptz;

notify pgrst, 'reload schema';
