-- Rollback for 0071_pre_con_data — drops every column it added.
-- Constraints get dropped automatically with their columns.

alter table reno_scopes
  drop column if exists existing_acorn_pendant_count,
  drop column if exists existing_wall_pack_count,
  drop column if exists existing_patio_furniture_count,
  drop column if exists existing_trashcan_count,
  drop column if exists existing_building_signs_count,
  drop column if exists existing_directional_signs_count,
  drop column if exists bollard_count,
  drop column if exists bollard_needs_repair_count,
  drop column if exists bollard_notes,
  drop column if exists steel_rust_severity,
  drop column if exists stucco_eifs_condition,
  drop column if exists nichiha_damage_count,
  drop column if exists doghouse_disposition,
  drop column if exists pylon_sign_condition,
  drop column if exists stall_canopy_condition,
  drop column if exists dt_order_canopy_condition,
  drop column if exists dumpster_enclosure_ready,
  drop column if exists drainage_issues_notes;

alter table stores
  drop column if exists has_stall_canopy,
  drop column if exists has_clearance_bar,
  drop column if exists has_dt_order_canopy;
