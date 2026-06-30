-- 0200_paf_final_check_hrs.sql
-- Bring back Final Check Hours on the Termination form. Migration 0019
-- (B-2b) flipped final_check_hrs to visible:false / required:false. Per
-- payroll, it needs to be collected on every termination again.
--
-- This UPDATEs the latest paf_form config_version in place — no new
-- version is inserted, so the form admin's version list stays clean and
-- the field flips on for the next form fetch. The column on
-- paf_submissions (numeric(10,2) NOT NULL DEFAULT 0) already exists from
-- 0016, so no schema change is needed.

update form_config
set config_json = jsonb_set(
  jsonb_set(
    config_json,
    '{fields,final_check_hrs,visible}',
    'true'::jsonb
  ),
  '{fields,final_check_hrs,required}',
  'true'::jsonb
)
where config_key = 'paf_form'
  and config_version = (
    select max(config_version)
      from form_config
     where config_key = 'paf_form'
  );

-- Verification
-- select config_version,
--        config_json->'fields'->'final_check_hrs'->>'visible'  as visible,
--        config_json->'fields'->'final_check_hrs'->>'required' as required
--   from form_config
--  where config_key = 'paf_form'
--  order by config_version desc
--  limit 1;
