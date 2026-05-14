-- supabase/migrations/0047_vendor_store_preferences.sql
--
-- Adds a per-store "preferred vendor" table so dispatchers can
-- mark "for HVAC at Store 1242, Frostex is the primary; Kniatt is
-- the backup." This is orthogonal to vendor_scopes:
--   * vendor_scopes  = WHO is allowed at this store
--   * preferences    = WHO is preferred for a category at this store
--
-- The vendor picker uses scopes to filter (visibility), then sorts
-- preferred vendors to the top within the visible set.
--
-- Category is free text matching the convention used in
-- vendors.category (comma-separated text). When a vendor's category
-- string contains the preference's category as a substring, the
-- pref applies. Loose matching mirrors how vendor search already
-- works ("HVAC" matches "HVAC, Refrigeration").
--
-- rank = 1 is the primary, 2 is the first backup, etc. Multiple
-- vendors can have the same rank — order between them isn't
-- guaranteed beyond the rank itself.
--
-- Also adds the wo2_strict_vendor_scopes feature flag for the
-- eventual switch from "no scope rows = visible everywhere" to
-- "no scope rows = invisible." Defaults OFF so behavior doesn't
-- change on apply.
--
-- Idempotent. Run on Soar Hub v2.

create table if not exists vendor_store_preferences (
  id            uuid        primary key default gen_random_uuid(),
  store_id      uuid        not null references stores(id) on delete cascade,
  category      text        not null,
  vendor_id     uuid        not null references vendors(id) on delete cascade,
  rank          int         not null default 1,
  notes         text,
  created_at    timestamptz not null default now(),
  created_by_id uuid        references profiles(id) on delete set null
);

-- A vendor can only appear once per (store, category) — no two
-- "primary HVAC" rows on the same store. The rank field still
-- allows multiple distinct vendors for the same store+category.
create unique index if not exists ux_vsp_unique_vendor
  on vendor_store_preferences(store_id, category, vendor_id);

create index if not exists idx_vsp_store_category
  on vendor_store_preferences(store_id, category, rank);

create index if not exists idx_vsp_vendor
  on vendor_store_preferences(vendor_id);

-- ── wo2_strict_vendor_scopes flag ────────────────────────────
-- Default OFF. When enabled, vendor with zero scope rows is hidden
-- everywhere (instead of "visible everywhere" legacy fallback).
-- Flip after every active vendor has at least one explicit scope
-- row (you can verify with:
--   select count(*) from vendors v
--   where v.is_active and not exists (
--     select 1 from vendor_scopes s where s.vendor_id = v.id
--   );
-- )
insert into feature_flags (key, enabled, notes)
values ('wo2_strict_vendor_scopes', false,
        'When true, vendors with no scope rows are hidden everywhere instead of falling through to legacy "visible everywhere" behavior. Flip after roster is fully scoped.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
