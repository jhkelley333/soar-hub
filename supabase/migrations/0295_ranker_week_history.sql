-- 0295_ranker_week_history.sql
-- One row per store per ranker week, unifying the legacy v1 (Google Sheet)
-- weeks and the v2 (ranking_rows) weeks so cross-week analysis reads one place.
-- Deliberately SEPARATE from ranking_rows so the live Ranker module is
-- untouched. week_key uniquely identifies a week and never collides across
-- sources ('S<week>' for a sheet week, 'D<week_ending>' for a DB run), so a
-- store's full-season rank history is a simple query here.

create table if not exists public.ranker_week_history (
  store_number text not null,
  week_key     text not null,      -- 'S33' (sheet wk 33) | 'D2026-08-16' (db run)
  source       text not null,      -- 'sheet' | 'db'
  fiscal_week  int,                -- sheet tab number, when known
  week_ending  date,               -- db run's week_ending, when known
  rank         int,
  total_points int,
  gm_name      text,
  imported_at  timestamptz not null default now(),
  primary key (store_number, week_key)
);

create index if not exists ranker_week_history_week_idx on public.ranker_week_history (week_key);
create index if not exists ranker_week_history_store_idx on public.ranker_week_history (store_number);

alter table public.ranker_week_history enable row level security;

-- Writes go through the service-role backfill function. Leaders (DO+) may read
-- it directly for analysis/debugging.
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'ranker_week_history_read') then
    create policy ranker_week_history_read on public.ranker_week_history
      for select using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.role in ('do','sdo','rvp','vp','coo','admin')
        )
      );
  end if;
end$$;

notify pgrst, 'reload schema';
