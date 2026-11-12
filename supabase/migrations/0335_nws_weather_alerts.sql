-- 0335_nws_weather_alerts.sql
-- NWS severe weather alerts: zone mapping, alert storage, and store matching.
-- No notification tables — alerts surface in-app only (dashboard banner + Weather page).

-- ── 1. store_nws_zones ────────────────────────────────────────────────────────
create table if not exists public.store_nws_zones (
  store_id      uuid        primary key references public.stores(id) on delete cascade,
  forecast_zone text,
  county_zone   text,
  refreshed_at  timestamptz not null default now()
);

-- ── 2. weather_alerts ─────────────────────────────────────────────────────────
create table if not exists public.weather_alerts (
  alert_id          text        primary key,
  event             text        not null,
  severity          text,
  urgency           text,
  certainty         text,
  headline          text,
  description       text,
  instruction       text,
  sent              timestamptz,
  effective         timestamptz,
  onset             timestamptz,
  expires           timestamptz,
  ends              timestamptz,
  message_type      text        not null default 'Alert'
                      check (message_type in ('Alert','Update','Cancel')),
  referenced_alerts text[]      not null default '{}',
  ugc               text[]      not null default '{}',
  geometry          jsonb,
  raw               jsonb,
  status            text        not null default 'active'
                      check (status in ('active','expired','cancelled')),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);

create index if not exists weather_alerts_status_expires_idx
  on public.weather_alerts (status, expires);
create index if not exists weather_alerts_ugc_idx
  on public.weather_alerts using gin (ugc);

-- ── 3. weather_alert_stores ───────────────────────────────────────────────────
create table if not exists public.weather_alert_stores (
  alert_id    text    not null references public.weather_alerts(alert_id) on delete cascade,
  store_id    uuid    not null references public.stores(id) on delete cascade,
  match_type  text    not null check (match_type in ('polygon','zone')),
  primary key (alert_id, store_id)
);

create index if not exists weather_alert_stores_store_idx
  on public.weather_alert_stores (store_id);

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
alter table public.store_nws_zones       enable row level security;
alter table public.weather_alerts        enable row level security;
alter table public.weather_alert_stores  enable row level security;

drop policy if exists store_nws_zones_read on public.store_nws_zones;
create policy store_nws_zones_read on public.store_nws_zones
  for select using (auth.uid() is not null);

drop policy if exists weather_alerts_read on public.weather_alerts;
create policy weather_alerts_read on public.weather_alerts
  for select using (auth.uid() is not null);

drop policy if exists weather_alert_stores_read on public.weather_alert_stores;
create policy weather_alert_stores_read on public.weather_alert_stores
  for select using (
    exists (
      select 1 from user_visible_stores(auth.uid()) v
      where v = store_id
    )
  );

grant select on public.store_nws_zones      to authenticated;
grant select on public.weather_alerts       to authenticated;
grant select on public.weather_alert_stores to authenticated;

-- ── 5. Realtime ───────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.weather_alerts;
alter publication supabase_realtime add table public.weather_alert_stores;

notify pgrst, 'reload schema';
