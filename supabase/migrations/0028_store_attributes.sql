-- supabase/migrations/0028_store_attributes.sql
--
-- Adds operational attributes + stall data to public.stores.
--
-- Surfaced in admin's Org Edit Store modal, in the bulk org import
-- CSV (admin-only batch population), and on the My Stores → store
-- detail page (read-only for non-admin viewers).
--
-- Columns:
--
-- Contact:
--   email                       — store-level email address
--
-- Active programs (booleans default false):
--   has_apple_pay               — accepts Apple Pay
--   has_order_ahead             — Order Ahead enabled
--   has_outdoor_seating         — outdoor seating present
--   has_drive_thru              — drive-thru exists
--   has_clearance_bar           — drive-thru clearance bar present
--
-- Drive-thru:
--   drive_thru_lanes            — 1 (single) or 2 (double); null = unknown
--   drive_thru_type             — 'single_pole_two_menus' | 'split_housing'
--
-- Restrooms:
--   public_restroom_count       — count of public restrooms (0 default)
--
-- Stall data:
--   patio_pop_menu_count        — count of patio POP menus
--   patio_pop_stall_numbers     — free-text comma list of stall #s
--   order_ahead_stall_count     — count of order-ahead-only stalls
--   order_ahead_stall_numbers   — free-text comma list of stall #s
--   stall_pop_menu_count        — count of stall POP menus
--   has_trailer_stall           — boolean
--   trailer_stall_number        — text (which stall # is the trailer)
--
-- Third-party delivery + extensible attributes:
--   third_party_delivery        — jsonb array of provider keys
--                                 (e.g. ["doordash","ubereats"])
--   attributes                  — jsonb object reserved for future
--                                 admin-extensible fields (Phase 2)
--
-- All columns nullable / default-safe for backfill; existing rows
-- retain their data.
--
-- Idempotent. Apply via the Supabase SQL editor against Soar Hub v2.

alter table stores
  add column if not exists email                     text,
  add column if not exists has_apple_pay             boolean not null default false,
  add column if not exists has_order_ahead           boolean not null default false,
  add column if not exists has_outdoor_seating       boolean not null default false,
  add column if not exists has_drive_thru            boolean not null default false,
  add column if not exists has_clearance_bar         boolean not null default false,
  add column if not exists drive_thru_lanes          int,
  add column if not exists drive_thru_type           text,
  add column if not exists public_restroom_count     int     not null default 0,
  add column if not exists patio_pop_menu_count      int     not null default 0,
  add column if not exists patio_pop_stall_numbers   text,
  add column if not exists order_ahead_stall_count   int     not null default 0,
  add column if not exists order_ahead_stall_numbers text,
  add column if not exists stall_pop_menu_count      int     not null default 0,
  add column if not exists has_trailer_stall         boolean not null default false,
  add column if not exists trailer_stall_number      text,
  add column if not exists third_party_delivery      jsonb   not null default '[]'::jsonb,
  add column if not exists attributes                jsonb   not null default '{}'::jsonb;

-- Constrain enum-like + jsonb shape values. Wrapped in DO blocks for
-- idempotency (re-running the migration won't fail with "already
-- exists" on the constraints).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stores_drive_thru_lanes_ck'
  ) then
    alter table stores add constraint stores_drive_thru_lanes_ck
      check (drive_thru_lanes is null or drive_thru_lanes in (1, 2));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'stores_drive_thru_type_ck'
  ) then
    alter table stores add constraint stores_drive_thru_type_ck
      check (drive_thru_type is null
             or drive_thru_type in ('single_pole_two_menus', 'split_housing'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'stores_third_party_delivery_arr_ck'
  ) then
    alter table stores add constraint stores_third_party_delivery_arr_ck
      check (jsonb_typeof(third_party_delivery) = 'array');
  end if;
end$$;

notify pgrst, 'reload schema';
