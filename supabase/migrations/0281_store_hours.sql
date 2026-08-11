-- 0281_store_hours.sql
-- Hours of Operation: standard weekly hours + dated special-hours overrides per store.

-- Standard weekly hours — one row per (store, weekday). day_of_week is 0=Monday
-- .. 6=Sunday to match the Mon-first grid. Times are local wall-clock (no TZ);
-- an overnight close (e.g. 07:00 open, 02:00 close) is detected in app logic when
-- close_time <= open_time. is_closed marks a dark day (times ignored).
create table if not exists store_hours (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  is_closed    boolean not null default false,
  open_time    time,
  close_time   time,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profiles(id),
  unique (store_id, day_of_week)
);
create index if not exists store_hours_store_idx on store_hours (store_id);

-- Dated overrides (holidays / one-off changes) — one row per (store, date).
create table if not exists store_special_hours (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  special_date  date not null,
  is_closed     boolean not null default false,
  open_time     time,
  close_time    time,
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references profiles(id),
  unique (store_id, special_date)
);
create index if not exists store_special_hours_store_idx on store_special_hours (store_id);

-- Access is via the service-role store-hours function (role-gated there); no RLS
-- policies needed (service role bypasses RLS, and the anon client never reads
-- these tables directly).

notify pgrst, 'reload schema';
