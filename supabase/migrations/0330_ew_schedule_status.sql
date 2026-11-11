-- 0330_ew_schedule_status.sql
-- Schedule status per store per week, pulled from ExpressWay by scrapekit.
-- One row per (store_number, week_start); re-running a week overwrites it
-- (unlike the labor backup fill, which never overwrites).

create table if not exists ew_schedule_status (
  store_number         text        not null,
  week_start           date        not null,
  status               smallint,            -- 0 No Shift Started / 6 Draft / 7 Submitted / 5 Approved / 4 Published
  status_step          smallint,            -- 1–5 workflow order
  status_label         text,
  forecast             numeric,
  adjusted_forecast    numeric,
  projected_splh       numeric,
  scheduled_labor_pct  numeric,             -- fraction e.g. 0.198
  target_labor_pct     numeric,             -- fraction
  budget_usage         numeric,             -- fraction
  rvp                  text,
  sdo                  text,
  do_name              text,
  pulled_at            timestamptz not null default now(),
  primary key (store_number, week_start)
);

create index if not exists ew_schedule_status_week_idx
  on ew_schedule_status (week_start desc);

create index if not exists ew_schedule_status_do_idx
  on ew_schedule_status (do_name, week_start desc);

alter table ew_schedule_status enable row level security;

-- RLS: service key only (same as labor_v2_daily).
-- No policies = only the service-role key can read or write.
-- The SOAR Hub Netlify function handles per-user org scoping in the query.
-- Add a direct-read policy here if DOs/RVPs need to query this table directly.

-- Narrow upsert function (scrapekit calls this via RPC).
-- Takes a JSON array of objects, one per store-week.
-- Overwrites every column on conflict (status advances through the workflow).
create or replace function scrapekit_schedule_status_upsert(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
begin
  insert into ew_schedule_status (
    store_number, week_start,
    status, status_step, status_label,
    forecast, adjusted_forecast, projected_splh,
    scheduled_labor_pct, target_labor_pct, budget_usage,
    rvp, sdo, do_name, pulled_at
  )
  select
    r->>'store_number',
    (r->>'week_start')::date,
    (r->>'status')::smallint,
    (r->>'status_step')::smallint,
    r->>'status_label',
    (r->>'forecast')::numeric,
    (r->>'adjusted_forecast')::numeric,
    (r->>'projected_splh')::numeric,
    (r->>'scheduled_labor_pct')::numeric,
    (r->>'target_labor_pct')::numeric,
    (r->>'budget_usage')::numeric,
    r->>'rvp',
    r->>'sdo',
    r->>'do_name',
    coalesce((r->>'pulled_at')::timestamptz, now())
  from jsonb_array_elements(rows) as r
  on conflict (store_number, week_start) do update set
    status              = excluded.status,
    status_step         = excluded.status_step,
    status_label        = excluded.status_label,
    forecast            = excluded.forecast,
    adjusted_forecast   = excluded.adjusted_forecast,
    projected_splh      = excluded.projected_splh,
    scheduled_labor_pct = excluded.scheduled_labor_pct,
    target_labor_pct    = excluded.target_labor_pct,
    budget_usage        = excluded.budget_usage,
    rvp                 = excluded.rvp,
    sdo                 = excluded.sdo,
    do_name             = excluded.do_name,
    pulled_at           = excluded.pulled_at;

  get diagnostics inserted = row_count;
  return jsonb_build_object('upserted', inserted);
end;
$$;

revoke execute on function scrapekit_schedule_status_upsert(jsonb) from public;
grant  execute on function scrapekit_schedule_status_upsert(jsonb) to service_role;
