-- 0159_weather.sql
-- Weather for the dashboard, centralized per city and recorded for history.
--
-- weather_locations: one row per city/market (the centroid of its stores), so a
--   town with 7 stores is a single location => a single Google Weather pull.
-- weather_observations: every scheduled pull is saved (current conditions + a
--   short daily forecast snapshot), so we keep a historical trend to look back on.
--
-- Service-role writes only (the weather-sync scheduled function); authenticated
-- users get read access (weather is non-sensitive, company-wide).

create table if not exists public.weather_locations (
  id             uuid primary key default gen_random_uuid(),
  city           text not null,
  state          text not null,
  label          text,                              -- "Fort Worth, TX"
  latitude       double precision not null,
  longitude      double precision not null,
  store_count    int not null default 0,
  is_active      boolean not null default true,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (city, state)
);

create table if not exists public.weather_observations (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.weather_locations(id) on delete cascade,
  observed_at    timestamptz not null default now(),
  business_date  date not null,
  -- current conditions
  temp_f         numeric,
  feels_like_f   numeric,
  condition      text,                              -- "Partly cloudy"
  condition_type text,                              -- Google weather type code
  icon_uri       text,
  humidity_pct   int,
  wind_mph       numeric,
  precip_prob_pct int,
  -- daily forecast snapshot: [{date, hi_f, lo_f, condition, icon, precip_prob}]
  forecast       jsonb,
  raw            jsonb,                             -- full Google payload (audit/debug)
  created_at     timestamptz not null default now()
);
create index if not exists weather_obs_loc_time_idx on public.weather_observations (location_id, observed_at desc);
create index if not exists weather_obs_loc_date_idx on public.weather_observations (location_id, business_date);

alter table public.weather_locations    enable row level security;
alter table public.weather_observations enable row level security;

drop policy if exists weather_locations_read on public.weather_locations;
create policy weather_locations_read on public.weather_locations for select using (auth.uid() is not null);
drop policy if exists weather_observations_read on public.weather_observations;
create policy weather_observations_read on public.weather_observations for select using (auth.uid() is not null);

grant select on public.weather_locations, public.weather_observations to authenticated;

notify pgrst, 'reload schema';
