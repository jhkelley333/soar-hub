-- supabase/migrations/0046_vendor_scopes.sql
--
-- Adds the vendor_scopes join table so vendors can be tagged with
-- where they actually serve (national / region / area / district /
-- store). Mirrors the user_scopes pattern already in use for
-- people, so the mental model is consistent.
--
-- Filter semantics (enforced in application code):
--   * Vendor has a 'national' scope row → visible to every store.
--   * Vendor has scope row matching a store's store_id, district_id,
--     area_id, or region_id → visible to that store.
--   * Vendor has ZERO scope rows → also visible to every store
--     (intentional backwards-compat — existing vendors keep
--     showing up without anyone having to backfill scopes).
--
-- We can flip the no-rows behavior to "invisible" later by treating
-- absent rows as a strict deny; the unique index gives us a clean
-- path to that if needed.
--
-- No changes to the vendors table itself. Existing columns
-- (services, category, service_area) stay as descriptive text.
-- This table is the operational filter.
--
-- Idempotent. Run on Soar Hub v2.

create table if not exists vendor_scopes (
  id            uuid        primary key default gen_random_uuid(),
  vendor_id     uuid        not null references vendors(id) on delete cascade,
  scope_type    text        not null,
  -- Nullable: scope_id is unused when scope_type = 'national'.
  -- For 'store' / 'district' / 'area' / 'region' it FKs to the
  -- corresponding parent table — we don't add an FK because the
  -- target depends on scope_type. Validated in app code.
  scope_id      uuid,
  created_at    timestamptz not null default now(),
  created_by_id uuid        references profiles(id) on delete set null
);

-- Enum check at the DB level so a hand-written SQL update can't
-- accidentally drift outside the supported set.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vendor_scopes_scope_type_chk'
  ) then
    alter table vendor_scopes
      add constraint vendor_scopes_scope_type_chk
      check (scope_type in ('national', 'region', 'area', 'district', 'store'));
  end if;
end$$;

-- 'national' rows have no scope_id; everything else MUST have one.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vendor_scopes_scope_id_required_chk'
  ) then
    alter table vendor_scopes
      add constraint vendor_scopes_scope_id_required_chk
      check (
        (scope_type = 'national' and scope_id is null) or
        (scope_type <> 'national' and scope_id is not null)
      );
  end if;
end$$;

-- Lookup paths.
create index if not exists idx_vendor_scopes_vendor
  on vendor_scopes(vendor_id);

create index if not exists idx_vendor_scopes_scope
  on vendor_scopes(scope_type, scope_id);

-- Prevent duplicates (e.g., two 'district:Edmond' rows on the
-- same vendor). For 'national' rows scope_id is null and the
-- partial unique index handles that case explicitly.
create unique index if not exists ux_vendor_scopes_scoped
  on vendor_scopes(vendor_id, scope_type, scope_id)
  where scope_type <> 'national';

create unique index if not exists ux_vendor_scopes_national
  on vendor_scopes(vendor_id)
  where scope_type = 'national';

notify pgrst, 'reload schema';
