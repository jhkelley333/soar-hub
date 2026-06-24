-- 0184_kpi_snapshots.sql
-- Stores periodic captures of the Expressway KPI feed (raw payload) so the
-- scheduled puller (7 / 9 / 11 AM Central, daily) builds a history. One row per
-- capture slot per day (unique on date+hour). Service-only: RLS on with no
-- policies, so only the service role (Netlify functions) can read/write.
-- Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

create table if not exists kpi_snapshots (
  id           uuid        primary key default gen_random_uuid(),
  captured_at  timestamptz not null default now(),
  central_date date        not null,
  central_hour int         not null,
  payload      jsonb       not null,
  unique (central_date, central_hour)
);

create index if not exists kpi_snapshots_captured_at_idx on kpi_snapshots (captured_at desc);

alter table kpi_snapshots enable row level security;
-- No policies → client roles denied; service role bypasses RLS.

notify pgrst, 'reload schema';
