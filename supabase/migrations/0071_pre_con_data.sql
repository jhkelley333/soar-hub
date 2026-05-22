-- supabase/migrations/0071_pre_con_data.sql
--
-- Adds Pre-Con data capture fields driven by the 2026 Inspire Reskin
-- Playbook "Scope of Work" slide. Two homes:
--
--   stores.* — structural / feature flags that describe the store today
--   (they're current attributes that get edited via the scope but live
--   canonically on the store). Whitelisted into the reno-scoping
--   netlify function's update-store-attributes action.
--
--   reno_scopes.* — point-in-time findings: counts of existing items
--   that will be demolished, condition assessments of paintable surfaces
--   and existing signage, and free-text site notes. These travel with
--   the scope so a post-reskin closeout can compare against pre-reskin
--   state.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- stores: building-level feature flags
-- ---------------------------------------------------------------------------

alter table stores
  add column if not exists has_stall_canopy     boolean not null default false,
  add column if not exists has_clearance_bar    boolean not null default false,
  add column if not exists has_dt_order_canopy  boolean not null default false;

-- ---------------------------------------------------------------------------
-- reno_scopes: pre-con inventory (counts of existing items)
-- ---------------------------------------------------------------------------

alter table reno_scopes
  -- Group A — demolition inventory
  add column if not exists existing_acorn_pendant_count    int not null default 0,
  add column if not exists existing_wall_pack_count        int not null default 0,
  add column if not exists existing_patio_furniture_count  int not null default 0,
  add column if not exists existing_trashcan_count         int not null default 0,
  add column if not exists existing_building_signs_count   int not null default 0,
  add column if not exists existing_directional_signs_count int not null default 0,
  -- bollards
  add column if not exists bollard_count                   int not null default 0,
  add column if not exists bollard_needs_repair_count      int not null default 0,
  add column if not exists bollard_notes                   text,
  -- Group B — surface-prep conditions
  add column if not exists steel_rust_severity             text,
  add column if not exists stucco_eifs_condition           text,
  add column if not exists nichiha_damage_count            int not null default 0,
  add column if not exists doghouse_disposition            text,
  -- Group C — existing signage condition
  add column if not exists pylon_sign_condition            text,
  -- Group D — site condition / canopies
  add column if not exists stall_canopy_condition          text,
  add column if not exists dt_order_canopy_condition       text,
  add column if not exists dumpster_enclosure_ready        boolean,
  add column if not exists drainage_issues_notes           text;

-- ---------------------------------------------------------------------------
-- Constraints — keep the new enum-ish text columns honest.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reno_scopes_steel_rust_severity_ck') then
    alter table reno_scopes
      add constraint reno_scopes_steel_rust_severity_ck
      check (steel_rust_severity is null or steel_rust_severity in ('low','medium','high'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reno_scopes_stucco_eifs_condition_ck') then
    alter table reno_scopes
      add constraint reno_scopes_stucco_eifs_condition_ck
      check (stucco_eifs_condition is null or stucco_eifs_condition in ('good','minor_cracks','needs_patch'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reno_scopes_doghouse_disposition_ck') then
    alter table reno_scopes
      add constraint reno_scopes_doghouse_disposition_ck
      check (doghouse_disposition is null or doghouse_disposition in ('paint','replace'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reno_scopes_pylon_sign_condition_ck') then
    alter table reno_scopes
      add constraint reno_scopes_pylon_sign_condition_ck
      check (pylon_sign_condition is null or pylon_sign_condition in ('good','reface','replace','none'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reno_scopes_stall_canopy_condition_ck') then
    alter table reno_scopes
      add constraint reno_scopes_stall_canopy_condition_ck
      check (stall_canopy_condition is null or stall_canopy_condition in ('good','fair','poor','remove'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reno_scopes_dt_order_canopy_condition_ck') then
    alter table reno_scopes
      add constraint reno_scopes_dt_order_canopy_condition_ck
      check (dt_order_canopy_condition is null or dt_order_canopy_condition in ('good','fair','poor','replace','none'));
  end if;
end $$;
