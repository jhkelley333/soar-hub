-- 0241_ranking_legacy_weeks.sql
-- Permanent archive of the legacy ranker's weekly history. The /ranker
-- module reads the SOAR metrics Google Sheet live; when the sheet retires
-- at ranking cutover, its trend history would die with it. This table
-- receives a one-time (idempotent, resumable) import of every week tab -
-- one row per store per fiscal week, raw metrics as jsonb. Service-role
-- gatekeeper: RLS on, no policies. Pure ASCII.

create table if not exists ranking_legacy_weeks (
  fiscal_week  int not null,
  week_ending  date,
  store_number text not null,
  store_name   text,
  gm_name      text,
  metrics      jsonb not null,
  imported_at  timestamptz not null default now(),
  primary key (fiscal_week, store_number)
);
create index if not exists ranking_legacy_weeks_store_idx
  on ranking_legacy_weeks (store_number, fiscal_week desc);

alter table ranking_legacy_weeks enable row level security;

notify pgrst, 'reload schema';
