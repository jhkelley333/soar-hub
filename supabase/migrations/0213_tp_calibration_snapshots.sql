-- 0213_tp_calibration_snapshots.sql
-- Quarterly talent-calibration snapshots for Team Pipeline. A company-wide
-- snapshot freezes every roster member's talent overlay (perf, potential,
-- risk, aspiration, role) for a period like '2026-Q3', so the 9-box can show
-- quarter-over-quarter movement and a locked period becomes the calibration
-- record of that quarter. Snapshots are taken + locked by org-wide roles
-- (VP+); everyone in scope can compare against them. Re-taking an OPEN period
-- overwrites its rows; a LOCKED period is immutable.

create table if not exists tp_snapshots (
  id            uuid primary key default gen_random_uuid(),
  period        text not null unique,          -- e.g. '2026-Q3'
  status        text not null default 'open',  -- open | locked
  member_count  int  not null default 0,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  locked_at     timestamptz,
  locked_by     uuid references profiles(id) on delete set null
);

create table if not exists tp_snapshot_rows (
  id           uuid primary key default gen_random_uuid(),
  snapshot_id  uuid not null references tp_snapshots(id) on delete cascade,
  member_id    uuid not null references tp_team_members(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  role         text,
  perf         int,
  potential    int,
  flight_risk  text,
  aspiration   text
);

create index if not exists tp_snapshot_rows_snap_idx on tp_snapshot_rows (snapshot_id);
create index if not exists tp_snapshot_rows_store_idx on tp_snapshot_rows (store_id);
create unique index if not exists tp_snapshot_rows_unique on tp_snapshot_rows (snapshot_id, member_id);

-- Service-role gatekeeper: RLS on, no policies — the function scope-checks.
alter table tp_snapshots enable row level security;
alter table tp_snapshot_rows enable row level security;

notify pgrst, 'reload schema';
