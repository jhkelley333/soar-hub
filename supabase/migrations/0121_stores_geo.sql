-- supabase/migrations/0121_stores_geo.sql
--
-- Store coordinates for the walkthrough GPS check-in geofence (0120). The
-- stores table had no lat/lng; the check-in gate compares the device fix to
-- these. geofence_radius_m lets ops widen the fence per-store (big lots,
-- shared plazas) — defaults to 150 m, matching DEFAULT_GEOFENCE_RADIUS_M in
-- src/modules/walkthrough/geofence.ts.
--
-- Nullable: stores without coordinates simply can't be geofenced yet (the
-- app falls back to letting the GM proceed with an off-site exception).
-- Idempotent.

alter table stores add column if not exists latitude         double precision;
alter table stores add column if not exists longitude        double precision;
alter table stores add column if not exists geofence_radius_m int not null default 150;

comment on column stores.latitude  is 'Store latitude for walkthrough check-in geofence.';
comment on column stores.longitude is 'Store longitude for walkthrough check-in geofence.';
comment on column stores.geofence_radius_m is
  'Geofence radius in meters for walkthrough check-in (default 150).';
