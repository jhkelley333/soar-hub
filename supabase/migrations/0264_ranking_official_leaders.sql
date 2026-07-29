-- 0264_ranking_official_leaders.sql
-- Companion to ranking_official_periods: the DO / SDO / RVP tiers of the
-- official "SOAR PTD RANKING" sheet, one row per leader per fiscal period. Lets
-- the Movers & Shakers DO tab compare the legacy sheet's leader ranks (closed
-- periods) against the new ranker's computed leader ranks (the active period).
-- match_key is the entity name with its "-DO"/"-SDO"/"-RVP" suffix stripped and
-- lower-cased, so the sheet ("Jose Soto-DO") joins the ranker ("Jose Soto").
-- Service-role gated: RLS on, no policies. Pure ASCII.

create table if not exists ranking_official_leaders (
  period       int  not null,
  tier         text not null,          -- 'do' | 'sdo' | 'rvp'
  entity_name  text not null,          -- as printed on the sheet (e.g. 'Jose Soto-DO')
  match_key    text not null,          -- normalized for the cross-source join
  sdo_name     text,                   -- the DO's SDO (do tier only)
  store_count  int,                    -- sdo / rvp tier
  rank         int,
  total_points numeric,
  ptd_sales    numeric,
  ly_sales     numeric,
  imported_at  timestamptz not null default now(),
  imported_by  uuid,
  primary key (period, tier, entity_name)
);
create index if not exists ranking_official_leaders_lookup_idx
  on ranking_official_leaders (period, tier, match_key);

alter table ranking_official_leaders enable row level security;

notify pgrst, 'reload schema';
