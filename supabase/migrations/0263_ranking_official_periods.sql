-- 0263_ranking_official_periods.sql
-- Stores the OFFICIAL "SOAR PTD RANKING" sheet numbers, one row per store per
-- fiscal period (period-ending / period-to-date). The /ranker recomputes ranks
-- live from the KPI feed; those can drift a hair from the legacy sheet's final
-- ranks. The recognition slides (7 UP, Movers & Shakers) want the sheet's exact
-- period-ending numbers, so we archive the store tier here and let those two
-- boards read it when a period is uploaded. Service-role gated: RLS on, no
-- policies. Pure ASCII.

create table if not exists ranking_official_periods (
  period       int  not null,
  store_number text not null,
  soar_rank    int,
  location     text,
  gm           text,
  total_points numeric,
  ptd_sales    numeric,
  ly_sales     numeric,
  pct_vs_ly    numeric,          -- fraction (0.4039 = +40.39%), matches run metrics
  imported_at  timestamptz not null default now(),
  imported_by  uuid,
  primary key (period, store_number)
);
create index if not exists ranking_official_periods_period_idx
  on ranking_official_periods (period desc, soar_rank asc);

alter table ranking_official_periods enable row level security;

notify pgrst, 'reload schema';
