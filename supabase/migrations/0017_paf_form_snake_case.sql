-- supabase/migrations/0017_paf_form_snake_case.sql
--
-- Re-seed paf_form config with snake_case field keys so they match the
-- backend column names in netlify/functions/paf.js and the
-- paf_submissions schema (0016). The original 0015 seed used camelCase
-- which caused "Last 4 SSN must be 4 digits" errors on valid input
-- (body.last4_ssn was undefined because the form sent body.last4SSN)
-- and broke the Job Position dropdown's special-case rendering.
--
-- Inserts a NEW config_version (does not modify the existing row), so
-- historical PAF submissions referencing earlier versions remain intact.
-- All non-fields config (sections, sectionTriggers, lists,
-- emailTemplates) is carried over unchanged from the latest existing
-- version.

insert into form_config (config_key, config_version, config_json, change_summary, updated_by)
select
  'paf_form',
  (select coalesce(max(config_version), 0) + 1
     from form_config
     where config_key = 'paf_form'),
  jsonb_build_object(
    'fields', jsonb_build_object(
      'pay_period_end',  jsonb_build_object('label','Pay Period End','placeholder','','helpText','Must be a Sunday.','required',true,'visible',true,'locked',true,'section','top'),
      'drive_in',        jsonb_build_object('label','Drive-In #','placeholder','Store #','helpText','','required',true,'visible',true,'locked',true,'section','top'),
      'market_do',       jsonb_build_object('label','Market / DO','placeholder','Market or DO name','helpText','','required',false,'visible',true,'locked',false,'section','top'),
      'employee_name',   jsonb_build_object('label','Employee Name','placeholder','Full legal name','helpText','','required',true,'visible',true,'locked',true,'section','top'),
      'last4_ssn',       jsonb_build_object('label','Last 4 SSN','placeholder','####','helpText','4 digits only.','required',true,'visible',true,'locked',true,'section','top'),
      'category',        jsonb_build_object('label','PAF Category','placeholder','Select...','helpText','','required',true,'visible',true,'locked',true,'section','top'),
      'job_position',    jsonb_build_object('label','Job Position','placeholder','','helpText','','required',false,'visible',true,'locked',false,'section','pay'),
      'approving_mgr',   jsonb_build_object('label','Approving Manager','placeholder','Name','helpText','','required',false,'visible',true,'locked',false,'section','pay'),
      'reg_pay_rate',    jsonb_build_object('label','Reg Pay Rate','placeholder','$0.00','helpText','Used in cost calculation.','required',true,'visible',true,'locked',true,'section','pay'),
      'reg_hours',       jsonb_build_object('label','Regular Hours','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'section','pay'),
      'ot_hours',        jsonb_build_object('label','OT Hours','placeholder','0','helpText','Calculated at 1.5x reg pay rate.','required',true,'visible',true,'locked',true,'section','pay'),
      'cc_tips',         jsonb_build_object('label','CC Tips','placeholder','$0.00','helpText','','required',true,'visible',true,'locked',true,'section','tips'),
      'declared_tips',   jsonb_build_object('label','Declared Tips','placeholder','$0.00','helpText','','required',true,'visible',true,'locked',true,'section','tips'),
      'pto_hours',       jsonb_build_object('label','PTO Hours Used','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'section','leave'),
      'illness_hours',   jsonb_build_object('label','Illness Hours Used','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'section','illness'),
      'original_store',  jsonb_build_object('label','Original Store','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'section','store'),
      'temp_new_store',  jsonb_build_object('label','Temp / New Store','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'section','store'),
      'store_chrged_ot', jsonb_build_object('label','Store Charged OT','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'section','store'),
      'last_day_worked', jsonb_build_object('label','Last Day Worked','placeholder','','helpText','','required',false,'visible',true,'locked',false,'section','term'),
      'final_check_hrs', jsonb_build_object('label','Final Check Hours','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'section','term'),
      'termed_in_tr',    jsonb_build_object('label','Termed in TR?','placeholder','','helpText','','required',false,'visible',true,'locked',false,'section','term'),
      'term_demotion',   jsonb_build_object('label','Termination / Demotion','placeholder','','helpText','','required',false,'visible',true,'locked',false,'section','term'),
      'spot_bonus_amt',  jsonb_build_object('label','Bonus Amount','placeholder','$0.00','helpText','Used in cost calculation.','required',true,'visible',true,'locked',true,'section','bonus'),
      'bonus_type',      jsonb_build_object('label','Bonus Type','placeholder','Select...','helpText','','required',false,'visible',true,'locked',false,'section','bonus'),
      'explanation',     jsonb_build_object('label','Brief Explanation','placeholder','Reason for this PAF...','helpText','','required',true,'visible',true,'locked',true,'section','notes')
    ),
    'sections',        latest.config_json->'sections',
    'sectionTriggers', latest.config_json->'sectionTriggers',
    'lists',           latest.config_json->'lists',
    'emailTemplates',  latest.config_json->'emailTemplates'
  ),
  'Migrate field keys to snake_case for backend alignment.',
  'system'
from (
  select config_json
  from form_config
  where config_key = 'paf_form'
  order by config_version desc
  limit 1
) as latest
where exists (
  select 1 from form_config where config_key = 'paf_form'
);
