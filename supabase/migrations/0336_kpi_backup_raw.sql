-- 0336_kpi_backup_raw.sql
-- Staging table for scrapekit-sourced KPI backfills; fallback when ExpressWay pull fails.

-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.kpi_backup_raw (
  id            uuid primary key default gen_random_uuid(),
  business_date date not null,
  day_data      jsonb,   -- rawData.businessDateData (per-store daily rows)
  wtd_data      jsonb,   -- rawData.weekToDateData   (per-store WTD rows)
  ptd_data      jsonb,   -- rawData.periodToDateData (per-store PTD rows)
  pulled_at     timestamptz not null default now(),
  source        text not null default 'scrapekit',
  constraint kpi_backup_raw_business_date_key unique (business_date)
);

comment on table public.kpi_backup_raw is
  'Staging area for scrapekit-pushed KPI data. '
  'Used as a fallback in runKpiCapture when the live ExpressWay feed is unavailable. '
  'Never overwrites a kpi_snapshots row that was captured from the live feed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: authenticated / anon users cannot touch this table directly.
-- service_role bypasses RLS entirely (Supabase superuser equivalent).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.kpi_backup_raw enable row level security;
-- No policies → only service_role can read/write.

-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER loader function
-- Validates shape, guards against future dates and double-runs, upserts.
-- Callable only by service_role (public execute revoked below).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.load_kpi_backup_raw(
  p_business_date  date,
  p_day_data       jsonb,
  p_wtd_data       jsonb   default '[]'::jsonb,
  p_ptd_data       jsonb   default '[]'::jsonb,
  p_source         text    default 'scrapekit'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing  kpi_backup_raw%rowtype;
begin
  -- Validate required args
  if p_business_date is null then
    raise exception 'business_date is required';
  end if;
  if p_business_date > current_date then
    raise exception 'business_date % is in the future', p_business_date;
  end if;
  if jsonb_typeof(p_day_data) is distinct from 'array' then
    raise exception 'day_data must be a JSON array';
  end if;

  -- Guard against double-runs: if a row was loaded within the last 10 minutes,
  -- skip to avoid clobbering a concurrent push.
  select * into v_existing
  from kpi_backup_raw
  where business_date = p_business_date;

  if found and v_existing.pulled_at > now() - interval '10 minutes' then
    return jsonb_build_object(
      'ok',        false,
      'reason',    'too_soon',
      'pulled_at', v_existing.pulled_at
    );
  end if;

  insert into kpi_backup_raw (business_date, day_data, wtd_data, ptd_data, source)
  values (
    p_business_date,
    p_day_data,
    coalesce(p_wtd_data, '[]'::jsonb),
    coalesce(p_ptd_data, '[]'::jsonb),
    coalesce(p_source, 'scrapekit')
  )
  on conflict (business_date) do update
    set day_data  = excluded.day_data,
        wtd_data  = excluded.wtd_data,
        ptd_data  = excluded.ptd_data,
        pulled_at = now(),
        source    = excluded.source;

  return jsonb_build_object('ok', true, 'business_date', p_business_date::text);
end;
$$;

-- Only service_role may call this function.
-- (service_role is a Supabase superuser equivalent and bypasses the revoke.)
revoke execute on function public.load_kpi_backup_raw(date, jsonb, jsonb, jsonb, text) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
select
  relname         as table_name,
  relrowsecurity  as rls_enabled
from pg_class
where relname = 'kpi_backup_raw'
  and relnamespace = 'public'::regnamespace;

select proname, prosecdef as security_definer
from pg_proc
where proname = 'load_kpi_backup_raw'
  and pronamespace = 'public'::regnamespace;
