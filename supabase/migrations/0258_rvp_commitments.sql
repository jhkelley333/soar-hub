-- 0258_rvp_commitments.sql
-- RVP Commitments: each region commits to a target per metric, and the
-- RVP Commitments page tracks the live actual against it. One row per
-- (region, metric). Metrics:
--   labor_hours_over  -- WTD Hours Over Chart, lower is better (target is a cap)
--   labor_avs_pct     -- WTD Actual vs Scheduled %, lower is better (cap)
--   cogs_efficiency   -- weekly COGS Efficiency %, higher is better (floor)
-- Targets are edited by the region's RVP (own region) or VP/COO/admin (any).
-- Service-role gatekeeper: RLS on, no policies.

create table if not exists rvp_commitments (
  id               uuid primary key default gen_random_uuid(),
  region           text not null,
  metric           text not null check (metric in ('labor_hours_over', 'labor_avs_pct', 'cogs_efficiency')),
  target_value     numeric not null,
  note             text,
  created_by_id    uuid references profiles(id) on delete set null,
  created_by_email text,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (region, metric)
);

alter table rvp_commitments enable row level security;

notify pgrst, 'reload schema';
