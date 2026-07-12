-- 0237_ranking_foundation.sql
-- Ranking module foundation (brief section 5, adapted to Hub conventions):
-- versioned config, one-time store seeds, source-file landing, runs and
-- result rows. No engine, no UI - schema only. Service-role gatekeeper:
-- RLS on, no policies; Netlify functions scope-check every read/write.
-- Pure ASCII.

-- 5.1 Versioned config: bands, avg_wage, chart2. Never overwrite - add a
-- new row with a later effective_from. Every run stamps the version used.
create table if not exists ranking_config (
  id             uuid primary key default gen_random_uuid(),
  key            text not null,             -- 'bands.sales_vs_ly', 'avg_wage', 'chart2', ...
  value          jsonb not null,
  effective_from date not null,
  note           text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists ranking_config_key_idx
  on ranking_config (key, effective_from desc);

-- avg_wage pinned per brief 4.1: validation must pass against the sheet
-- before the Labor v2 wage flips in as a dated config change.
insert into ranking_config (key, value, effective_from, note)
values ('avg_wage', '{"amount": 12.84}'::jsonb, '2025-12-29',
        'Pinned for Phase 0 port validation (brief 4.1). Flip to Labor v2 wage post-cutover as a dated change.');

-- 5.2 One-time store seeds: labor pad (never zero it - brief 5.1) and
-- legal entity (entities.csv covers 191/271; gaps surface as issues).
create table if not exists ranking_store_seed (
  store_id  uuid primary key references stores(id) on delete cascade,
  labor_pad numeric,
  entity    text,
  updated_at timestamptz not null default now()
);

-- 5.3 Source-file landing: six external sources, raw rows kept.
create table if not exists ranking_source_files (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('ix','ecosure','vog','shops','bsc','totzone')),
  storage_path text not null,
  sha256       text not null,
  week_ending  date,
  row_count    int,
  status       text not null default 'pending' check (status in ('pending','parsed','failed')),
  error        text,
  uploaded_by  uuid references profiles(id) on delete set null,
  uploaded_at  timestamptz not null default now(),
  unique (source, sha256)
);

create table if not exists ranking_src_rows (
  id         bigserial primary key,
  file_id    uuid not null references ranking_source_files(id) on delete cascade,
  source     text not null,
  store_id   uuid references stores(id) on delete set null,
  store_code text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ranking_src_rows_source_idx
  on ranking_src_rows (source, store_id);
create index if not exists ranking_src_rows_file_idx
  on ranking_src_rows (file_id);

-- 5.4 Runs and result rows. History IS ranking_rows (one row per entity
-- per run). week_misaligned is the guard from brief 5.5 - never silently
-- render the wrong week.
create table if not exists ranking_runs (
  id                  uuid primary key default gen_random_uuid(),
  week_ending         date not null,
  period              int not null,
  week                int not null,
  weeks_in_period     int not null,
  config_version      date not null,
  snapshot_date       date,
  snapshot_week_start date,
  week_misaligned     boolean not null default false,
  status              text not null default 'running' check (status in ('running','complete','failed')),
  issues              jsonb not null default '[]'::jsonb,
  source_status       jsonb not null default '{}'::jsonb,
  started_by          uuid references profiles(id) on delete set null,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index if not exists ranking_runs_week_idx
  on ranking_runs (week_ending desc, started_at desc);

create table if not exists ranking_rows (
  run_id       uuid not null references ranking_runs(id) on delete cascade,
  scope        text not null check (scope in ('ptd','wtd')),
  tier         text not null check (tier in ('store','do','sdo','rvp','entity','company')),
  entity_key   text not null,        -- store code, or 'do:<uuid>' etc (brief 4.2)
  store_id     uuid references stores(id) on delete set null,
  leader_id    uuid references profiles(id) on delete set null,
  rank         int,
  total_points int,
  metrics      jsonb not null,
  primary key (run_id, scope, tier, entity_key)
);
create index if not exists ranking_rows_rank_idx
  on ranking_rows (run_id, scope, tier, rank);
create index if not exists ranking_rows_store_idx
  on ranking_rows (store_id, scope);

alter table ranking_config       enable row level security;
alter table ranking_store_seed   enable row level security;
alter table ranking_source_files enable row level security;
alter table ranking_src_rows     enable row level security;
alter table ranking_runs         enable row level security;
alter table ranking_rows         enable row level security;

notify pgrst, 'reload schema';
