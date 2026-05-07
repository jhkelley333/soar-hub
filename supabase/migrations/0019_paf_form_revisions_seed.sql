-- supabase/migrations/0019_paf_form_revisions_seed.sql
--
-- Phase: PR B-2b — re-seed paf_form config_version with the new
-- section/field/list shape introduced by the form revisions.
--
-- Changes vs. v2 (post-0017):
--   * Categories: drop "Final Check" + "Other"; consolidate "Spot
--     Bonus" / "Training" / "Referral Bonus" / "Other Bonus" into a
--     single "Bonus" category that branches on bonus_type.
--   * New top-of-form field: pay_basis (Hourly | Salary). Toggles
--     reg_pay_rate visibility across pay/leave/illness sections.
--   * reg_pay_rate moves from "pay" to "top" so the conditional show/
--     hide is uniform regardless of which leave-type section is open.
--   * Termination: drops final_check_hrs + term_demotion fields. New
--     submissions write null; historical rows untouched.
--   * Transfer: dedicated section (current_store, new_store,
--     current_position, new_position + shared current/new_pay_rate).
--   * Demotion: dedicated section (current_role, new_role,
--     current/new_pay_rate, location_change, new_location).
--   * Bonus consolidated: bonus_type drives 1 of 3 sub-sections
--     (bonus_spot, bonus_training, bonus_referral) with the right
--     fields each.
--   * New status: "Pending SDO Approval" — bonus PAFs land here
--     before Payroll. Added to lockedStatuses.
--   * New list: referralTiers (label + amount rows) for the Referral
--     bonus tier dropdown's auto-fill.
--   * New email templates: BONUS_SDO_APPROVAL_REQUEST,
--     BONUS_SDO_APPROVED, BONUS_SDO_REJECTED.
--
-- Field config schema: each field's "sections" is an array, allowing
-- shared fields (e.g. current_pay_rate used by Transfer + Demotion) to
-- live in multiple sections without duplicating column names. The form
-- reader accepts both "sections": ["x","y"] and legacy "section": "x".

insert into form_config (config_key, config_version, config_json, change_summary, updated_by)
select
  'paf_form',
  (select coalesce(max(config_version), 0) + 1
     from form_config
     where config_key = 'paf_form'),
  jsonb_build_object(
    'fields', jsonb_build_object(
      -- Top (always shown)
      'pay_period_end',  jsonb_build_object('label','Pay Period End','placeholder','','helpText','Must be a Sunday.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('top')),
      'drive_in',        jsonb_build_object('label','Drive-In #','placeholder','Store #','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('top')),
      'market_do',       jsonb_build_object('label','Market / DO','placeholder','Market or DO name','helpText','','required',false,'visible',true,'locked',false,'sections',jsonb_build_array('top')),
      'employee_name',   jsonb_build_object('label','Employee Name','placeholder','Full legal name','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('top')),
      'last4_ssn',       jsonb_build_object('label','Last 4 SSN','placeholder','####','helpText','4 digits only.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('top')),
      'category',        jsonb_build_object('label','PAF Category','placeholder','Select...','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('top')),
      'pay_basis',       jsonb_build_object('label','Pay Basis','placeholder','Select...','helpText','Salary employees skip Reg Pay Rate.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('top')),
      'reg_pay_rate',    jsonb_build_object('label','Reg Pay Rate','placeholder','$0.00','helpText','Hidden when Pay Basis is Salary.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('top')),

      -- Position & Pay (default for non-bonus / non-leave categories)
      'job_position',    jsonb_build_object('label','Job Position','placeholder','','helpText','','required',false,'visible',true,'locked',false,'sections',jsonb_build_array('pay')),
      'approving_mgr',   jsonb_build_object('label','Approving Manager','placeholder','Name','helpText','','required',false,'visible',true,'locked',false,'sections',jsonb_build_array('pay')),
      'reg_hours',       jsonb_build_object('label','Regular Hours','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('pay')),
      'ot_hours',        jsonb_build_object('label','OT Hours','placeholder','0','helpText','Calculated at 1.5x reg pay rate.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('pay')),

      -- Tips
      'cc_tips',         jsonb_build_object('label','CC Tips','placeholder','$0.00','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('tips')),
      'declared_tips',   jsonb_build_object('label','Declared Tips','placeholder','$0.00','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('tips')),

      -- PTO / Illness
      'pto_hours',       jsonb_build_object('label','PTO Hours Used','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('leave')),
      'illness_hours',   jsonb_build_object('label','Illness Hours Used','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('illness')),

      -- Cross Store Work routing
      'original_store',  jsonb_build_object('label','Original Store','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'sections',jsonb_build_array('store')),
      'temp_new_store',  jsonb_build_object('label','Temp / New Store','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'sections',jsonb_build_array('store')),
      'store_chrged_ot', jsonb_build_object('label','Store Charged OT','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'sections',jsonb_build_array('store')),

      -- Transfer (dedicated; shares current/new_pay_rate with Demotion)
      'current_store',   jsonb_build_object('label','Original Store','placeholder','Store #','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('transfer')),
      'new_store',       jsonb_build_object('label','New Store','placeholder','Store #','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('transfer')),
      'current_position',jsonb_build_object('label','Current Position','placeholder','Select...','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('transfer')),
      'new_position',    jsonb_build_object('label','New Position','placeholder','Select...','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('transfer')),

      -- Termination (dropped final_check_hrs + term_demotion)
      'last_day_worked', jsonb_build_object('label','Last Day Worked','placeholder','','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('term')),
      'termed_in_tr',    jsonb_build_object('label','Termed in TR?','placeholder','','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('term')),

      -- Hidden legacy fields (kept visible:false so historical rows still display);
      -- new submissions never collect them.
      'final_check_hrs', jsonb_build_object('label','Final Check Hours','placeholder','0','helpText','','required',false,'visible',false,'locked',false,'sections',jsonb_build_array('term')),
      'term_demotion',   jsonb_build_object('label','Termination / Demotion','placeholder','','helpText','','required',false,'visible',false,'locked',false,'sections',jsonb_build_array('term')),

      -- Demotion (dedicated)
      'from_role',       jsonb_build_object('label','Current Role','placeholder','Select...','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('demotion')),
      'new_role',        jsonb_build_object('label','New Role','placeholder','Select...','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('demotion')),
      'current_pay_rate',jsonb_build_object('label','Current Pay Rate','placeholder','$0.00','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('demotion','transfer')),
      'new_pay_rate',    jsonb_build_object('label','New Pay Rate','placeholder','$0.00','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('demotion','transfer')),
      'location_change', jsonb_build_object('label','Location Change?','placeholder','','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('demotion')),
      'new_location',    jsonb_build_object('label','New Location (Store #)','placeholder','Store #','helpText','Required when Location Change = Yes.','required',false,'visible',true,'locked',false,'sections',jsonb_build_array('demotion')),

      -- Bonus parent + sub-sections
      'bonus_type',      jsonb_build_object('label','Bonus Type','placeholder','Select...','helpText','Drives the rest of the bonus form.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('bonus')),

      'spot_bonus_amt',  jsonb_build_object('label','Bonus Amount','placeholder','$0.00','helpText','Used in cost calculation.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('bonus_spot')),
      'spot_bonus_reason', jsonb_build_object('label','For What','placeholder','Brief reason','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('bonus_spot')),

      'training_bonus_amt',jsonb_build_object('label','Training Bonus Amount','placeholder','$0.00','helpText','Used in cost calculation.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('bonus_training')),
      'trained_employee_name', jsonb_build_object('label','Who Was Trained','placeholder','Full name','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('bonus_training')),
      'trained_at_store', jsonb_build_object('label','At What Store','placeholder','Store #','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('bonus_training')),
      'training_days',   jsonb_build_object('label','Days','placeholder','0','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('bonus_training')),

      'referral_tier',   jsonb_build_object('label','Referral Tier','placeholder','Select...','helpText','Auto-fills the amount; you can still edit.','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('bonus_referral')),
      'referral_bonus_amt', jsonb_build_object('label','Bonus Amount','placeholder','$0.00','helpText','Used in cost calculation.','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('bonus_referral')),
      'referred_employee_name', jsonb_build_object('label','Referred Employee Name','placeholder','Full name','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('bonus_referral')),
      'referral_start_date', jsonb_build_object('label','Start Date','placeholder','','helpText','','required',true,'visible',true,'locked',false,'sections',jsonb_build_array('bonus_referral')),

      -- Notes
      'explanation',     jsonb_build_object('label','Brief Explanation','placeholder','Reason for this PAF...','helpText','','required',true,'visible',true,'locked',true,'sections',jsonb_build_array('notes'))
    ),
    'sections', jsonb_build_array(
      jsonb_build_object('key','pay',           'title','Position & Pay',  'description','','order',1),
      jsonb_build_object('key','tips',          'title','Tips',             'description','','order',2),
      jsonb_build_object('key','leave',         'title','PTO',              'description','','order',3),
      jsonb_build_object('key','illness',       'title','Illness',          'description','','order',4),
      jsonb_build_object('key','store',         'title','Cross Store Work', 'description','','order',5),
      jsonb_build_object('key','transfer',      'title','Transfer',         'description','','order',6),
      jsonb_build_object('key','term',          'title','Termination',      'description','','order',7),
      jsonb_build_object('key','demotion',      'title','Demotion',         'description','','order',8),
      jsonb_build_object('key','bonus',         'title','Bonus',            'description','Pick a bonus type to reveal the rest of the form.','order',9),
      jsonb_build_object('key','bonus_spot',    'title','Spot Bonus',       'description','','order',10),
      jsonb_build_object('key','bonus_training','title','Training Bonus',   'description','','order',11),
      jsonb_build_object('key','bonus_referral','title','Referral Bonus',   'description','','order',12),
      jsonb_build_object('key','notes',         'title','Notes',            'description','','order',13)
    ),
    'sectionTriggers', jsonb_build_object(
      'pay',            jsonb_build_array('default'),
      'tips',           jsonb_build_array('POS Adjustment','Backpay','Cross Store Work'),
      'leave',          jsonb_build_array('PTO'),
      'illness',        jsonb_build_array('Illness'),
      'store',          jsonb_build_array('Cross Store Work'),
      'transfer',       jsonb_build_array('Transfer'),
      'term',           jsonb_build_array('Termination'),
      'demotion',       jsonb_build_array('Demotion'),
      'bonus',          jsonb_build_array('Bonus'),
      'bonus_spot',     jsonb_build_array('Bonus + Spot Bonus'),
      'bonus_training', jsonb_build_array('Bonus + Training'),
      'bonus_referral', jsonb_build_array('Bonus + Referral'),
      'notes',          jsonb_build_array('always')
    ),
    'lists', jsonb_build_object(
      'categories', jsonb_build_array(
        'POS Adjustment','Cross Store Work','PTO','Illness','Backpay',
        'Termination','Transfer','Demotion','Bonus'
      ),
      'positions', jsonb_build_array(
        'Carhop','Cook','Crew Member','Shift Manager',
        'Assistant Manager','General Manager','Operating Partner','Director of Operations'
      ),
      'bonusTypes', jsonb_build_array(
        'Spot Bonus','Training','Referral'
      ),
      'payBases', jsonb_build_array(
        'Hourly','Salary'
      ),
      'referralTiers', jsonb_build_array(
        jsonb_build_object('label','Crew Member',       'amount',100),
        jsonb_build_object('label','Associate Manager', 'amount',250),
        jsonb_build_object('label','General Manager',   'amount',500)
      ),
      'statuses', jsonb_build_array(
        'Pending','Pending SDO Approval','Approved','Rejected','Needs Approval','Needs Info','Processed'
      ),
      'lockedStatuses', jsonb_build_array(
        'Pending','Pending SDO Approval','Approved','Rejected','Processed','Needs Approval'
      )
    ),
    'emailTemplates', jsonb_build_object(
      'PAF_SUBMITTED', jsonb_build_object(
        'subject','[SOAR PAF] New PAF submitted — {{EMPLOYEE}} ({{STORE}})',
        'body','A new PAF has been submitted by {{DO}}.' || E'\n\n' ||
               'Employee: {{EMPLOYEE}}' || E'\n' ||
               'Store: {{STORE}}' || E'\n' ||
               'Category: {{CATEGORY}}' || E'\n' ||
               'Estimated cost: {{AMOUNT}}' || E'\n\n' ||
               'View it in the portal: {{LINK}}'
      ),
      'PAF_REJECTED', jsonb_build_object(
        'subject','[SOAR PAF] Your PAF was rejected — {{EMPLOYEE}}',
        'body','Your PAF for {{EMPLOYEE}} at store {{STORE}} was rejected.' || E'\n\n' ||
               'Reason: {{REASON}}' || E'\n\n' ||
               'View / re-submit: {{LINK}}'
      ),
      'NEEDS_APPROVAL', jsonb_build_object(
        'subject','[SOAR PAF] Approval requested — {{EMPLOYEE}} ({{STORE}})',
        'body','Payroll is requesting your approval on the following PAF.' || E'\n\n' ||
               'Employee: {{EMPLOYEE}}' || E'\n' ||
               'Store: {{STORE}}' || E'\n\n' ||
               'Notes from Payroll: {{NOTES}}' || E'\n\n' ||
               'Approve via this link (expires in 72 hours): {{LINK}}'
      ),
      'PAF_PROCESSED', jsonb_build_object(
        'subject','[SOAR PAF] Processed — {{EMPLOYEE}} ({{STORE}})',
        'body','Your PAF has been processed by Payroll.' || E'\n\n' ||
               'Employee: {{EMPLOYEE}}' || E'\n' ||
               'Store: {{STORE}}' || E'\n' ||
               'Processed amount: {{AMOUNT}}' || E'\n\n' ||
               'View: {{LINK}}'
      ),
      'APPROVAL_CONFIRMED', jsonb_build_object(
        'subject','[SOAR PAF] Approval received — {{EMPLOYEE}} ({{STORE}})',
        'body','An approver has confirmed the PAF for {{EMPLOYEE}} at store {{STORE}}.' || E'\n\n' ||
               'It is back in the Payroll queue: {{LINK}}'
      ),
      'BONUS_SDO_APPROVAL_REQUEST', jsonb_build_object(
        'subject','[SOAR PAF] Bonus needs your approval — {{EMPLOYEE}} ({{STORE}})',
        'body','A bonus PAF is awaiting your approval before it goes to Payroll.' || E'\n\n' ||
               'Employee: {{EMPLOYEE}}' || E'\n' ||
               'Store: {{STORE}}' || E'\n' ||
               'Bonus type: {{BONUS_TYPE}}' || E'\n' ||
               'Amount: {{AMOUNT}}' || E'\n\n' ||
               'Submitted by: {{DO}}' || E'\n\n' ||
               'Review in your dashboard: {{LINK}}'
      ),
      'BONUS_SDO_APPROVED', jsonb_build_object(
        'subject','[SOAR PAF] Bonus approved — {{EMPLOYEE}} ({{STORE}})',
        'body','Your bonus PAF for {{EMPLOYEE}} at store {{STORE}} has been approved by {{APPROVER}} and forwarded to Payroll.' || E'\n\n' ||
               'View: {{LINK}}'
      ),
      'BONUS_SDO_REJECTED', jsonb_build_object(
        'subject','[SOAR PAF] Bonus rejected — {{EMPLOYEE}} ({{STORE}})',
        'body','Your bonus PAF for {{EMPLOYEE}} at store {{STORE}} was rejected by {{APPROVER}}.' || E'\n\n' ||
               'Reason: {{REASON}}' || E'\n\n' ||
               'View / re-submit: {{LINK}}'
      )
    )
  ),
  'PR B-2b: form revisions, dedicated Transfer/Demotion, consolidated Bonus, SDO approval workflow.',
  'system'
where exists (
  select 1 from form_config where config_key = 'paf_form'
);
