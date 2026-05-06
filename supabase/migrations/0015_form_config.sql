-- supabase/migrations/0015_form_config.sql
--
-- Phase: PAF admin config (Tier 1).
--
-- Stores immutable, versioned form configurations. Every save creates a
-- NEW row with config_version incremented; existing rows are never
-- updated. This gives free history + audit and lets PAF submissions
-- reference the exact config_version they were submitted under so
-- future schema changes don't break old submission displays.
--
-- The first config row (config_version: 1) is seeded on first deploy by
-- the migration below from the App Script DEFAULTS constant + the
-- locked-field set + the section trigger map. Behavior is identical
-- before and after this migration runs — Payroll has to opt-in to
-- changes by editing through the admin UI.
--
-- RLS: payroll + admin can SELECT (read latest config server-side via
-- the netlify function, which uses service-role key, but direct table
-- access is also allowed for them). Only payroll + admin can INSERT
-- new versions; the netlify function enforces this server-side too.

create table if not exists form_config (
  id              uuid        primary key default uuid_generate_v4(),
  config_key      text        not null,
  config_version  integer     not null,
  config_json     jsonb       not null,
  change_summary  text,
  updated_by      text        not null,
  updated_at      timestamptz not null default now(),
  unique (config_key, config_version)
);

create index if not exists form_config_key_version_idx
  on form_config (config_key, config_version desc);

alter table form_config enable row level security;

-- payroll + admin can read all configs.
do $$
begin
  if not exists (
    select 1 from pg_policies where policyname = 'form_config_read'
  ) then
    create policy form_config_read on form_config for select
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid()
            and role in ('payroll', 'admin')
        )
      );
  end if;

  -- payroll + admin can insert new versions; updates/deletes blocked.
  -- (The netlify function uses the service-role key so it bypasses RLS;
  -- this policy is mainly belt-and-suspenders for direct client writes.)
  if not exists (
    select 1 from pg_policies where policyname = 'form_config_insert'
  ) then
    create policy form_config_insert on form_config for insert
      with check (
        exists (
          select 1 from public.profiles
          where id = auth.uid()
            and role in ('payroll', 'admin')
        )
      );
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- Seed: paf_form config_version 1
-- ----------------------------------------------------------------------------
-- Mirrors:
--   * DEFAULTS (categories, statuses, termType, positions, bonusTypes)
--   * The locked-field set per the spec (cannot hide / cannot make optional)
--   * The 9 sections from Index.html with their bindCat() trigger map
-- The trigger map is informational only — bindCat() logic stays in code.

insert into form_config (config_key, config_version, config_json, change_summary, updated_by)
select
  'paf_form',
  1,
  jsonb_build_object(
    'fields', jsonb_build_object(
      -- Top-level (always shown)
      'payPeriodEnd', jsonb_build_object('label','Pay Period End','placeholder','','helpText','Must be a Sunday.','required',true,'visible',true,'locked',true,'section','top'),
      'driveIn',      jsonb_build_object('label','Drive-In #','placeholder','Store #','helpText','','required',true,'visible',true,'locked',true,'section','top'),
      'marketDO',     jsonb_build_object('label','Market / DO','placeholder','Market or DO name','helpText','','required',false,'visible',true,'locked',false,'section','top'),
      'employeeName', jsonb_build_object('label','Employee Name','placeholder','Full legal name','helpText','','required',true,'visible',true,'locked',true,'section','top'),
      'last4SSN',     jsonb_build_object('label','Last 4 SSN','placeholder','####','helpText','4 digits only.','required',true,'visible',true,'locked',true,'section','top'),
      'category',     jsonb_build_object('label','PAF Category','placeholder','Select...','helpText','','required',true,'visible',true,'locked',true,'section','top'),
      -- Position & Pay
      'jobPosition',  jsonb_build_object('label','Job Position','placeholder','','helpText','','required',false,'visible',true,'locked',false,'section','pay'),
      'approvingMgr', jsonb_build_object('label','Approving Manager','placeholder','Name','helpText','','required',false,'visible',true,'locked',false,'section','pay'),
      'regPayRate',   jsonb_build_object('label','Reg Pay Rate','placeholder','$0.00','helpText','Used in cost calculation.','required',true,'visible',true,'locked',true,'section','pay'),
      'regHours',     jsonb_build_object('label','Regular Hours','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'section','pay'),
      'otHours',      jsonb_build_object('label','OT Hours','placeholder','0','helpText','Calculated at 1.5x reg pay rate.','required',true,'visible',true,'locked',true,'section','pay'),
      -- Tips
      'ccTips',       jsonb_build_object('label','CC Tips','placeholder','$0.00','helpText','','required',true,'visible',true,'locked',true,'section','tips'),
      'declaredTips', jsonb_build_object('label','Declared Tips','placeholder','$0.00','helpText','','required',true,'visible',true,'locked',true,'section','tips'),
      -- PTO
      'ptoHours',     jsonb_build_object('label','PTO Hours Used','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'section','leave'),
      -- Illness
      'illnessHours', jsonb_build_object('label','Illness Hours Used','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'section','illness'),
      -- Store routing
      'originalStore',jsonb_build_object('label','Original Store','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'section','store'),
      'tempNewStore', jsonb_build_object('label','Temp / New Store','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'section','store'),
      'storeChrgedOT',jsonb_build_object('label','Store Charged OT','placeholder','Store #','helpText','','required',false,'visible',true,'locked',false,'section','store'),
      -- Term / Final Check
      'lastDayWorked',jsonb_build_object('label','Last Day Worked','placeholder','','helpText','','required',false,'visible',true,'locked',false,'section','term'),
      'finalCheckHrs',jsonb_build_object('label','Final Check Hours','placeholder','0','helpText','','required',true,'visible',true,'locked',true,'section','term'),
      'termedInTR',   jsonb_build_object('label','Termed in TR?','placeholder','','helpText','','required',false,'visible',true,'locked',false,'section','term'),
      'termDemotion', jsonb_build_object('label','Termination / Demotion','placeholder','','helpText','','required',false,'visible',true,'locked',false,'section','term'),
      -- Bonus
      'spotBonusAmt', jsonb_build_object('label','Bonus Amount','placeholder','$0.00','helpText','Used in cost calculation.','required',true,'visible',true,'locked',true,'section','bonus'),
      'bonusType',    jsonb_build_object('label','Bonus Type','placeholder','Select...','helpText','','required',false,'visible',true,'locked',false,'section','bonus'),
      -- Notes (always shown)
      'explanation',  jsonb_build_object('label','Brief Explanation','placeholder','Reason for this PAF...','helpText','','required',true,'visible',true,'locked',true,'section','notes')
    ),
    'sections', jsonb_build_array(
      jsonb_build_object('key','pay',     'title','Position & Pay',          'description','','order',1),
      jsonb_build_object('key','tips',    'title','Tips',                    'description','','order',2),
      jsonb_build_object('key','leave',   'title','PTO',                     'description','','order',3),
      jsonb_build_object('key','illness', 'title','Illness',                 'description','','order',4),
      jsonb_build_object('key','store',   'title','Store Routing',           'description','','order',5),
      jsonb_build_object('key','term',    'title','Termination / Final Check','description','','order',6),
      jsonb_build_object('key','demotion','title','Demotion',                'description','','order',7),
      jsonb_build_object('key','bonus',   'title','Bonus Details',           'description','','order',8),
      jsonb_build_object('key','notes',   'title','Notes',                   'description','','order',9)
    ),
    'sectionTriggers', jsonb_build_object(
      'pay',      jsonb_build_array('default'),
      'tips',     jsonb_build_array('POS Adjustment','Backpay','Other','Cross Store Work','Transfer'),
      'leave',    jsonb_build_array('PTO'),
      'illness',  jsonb_build_array('Illness'),
      'store',    jsonb_build_array('Cross Store Work','Transfer'),
      'term',     jsonb_build_array('Termination','Final Check'),
      'demotion', jsonb_build_array('Demotion'),
      'bonus',    jsonb_build_array('Spot Bonus','Training','Referral Bonus','Other Bonus','Training Completion'),
      'notes',    jsonb_build_array('always')
    ),
    'lists', jsonb_build_object(
      'categories', jsonb_build_array(
        'POS Adjustment','Cross Store Work','PTO','Illness','Backpay',
        'Termination','Transfer','Demotion','Final Check','Other',
        'Spot Bonus','Training','Referral Bonus','Other Bonus'
      ),
      'positions', jsonb_build_array(
        'Carhop','Cook','Crew Member','Shift Manager',
        'Assistant Manager','General Manager','Operating Partner','Director of Operations'
      ),
      'bonusTypes', jsonb_build_array(
        'Spot Bonus','Training Completion','Referral Bonus','Other'
      ),
      'statuses', jsonb_build_array(
        'Pending','Approved','Rejected','Needs Approval','Needs Info','Processed'
      ),
      'lockedStatuses', jsonb_build_array(
        'Pending','Approved','Rejected','Processed','Needs Approval'
      ),
      'termTypes', jsonb_build_array(
        'Termination','Demotion','N/A'
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
      )
    )
  ),
  'Initial seed (matches App Script DEFAULTS).',
  'system'
where not exists (
  select 1 from form_config
  where config_key = 'paf_form' and config_version = 1
);
