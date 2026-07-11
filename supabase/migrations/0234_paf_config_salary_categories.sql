-- 0234_paf_config_salary_categories.sql
-- Bring the two code-driven PAF categories into the admin config so they can
-- be managed on /admin/paf-config: New Hire (Salary Leader) and
-- Pay Adjustment (Salary) join lists.categories, their custom fields get
-- config entries (labels + help text are honored by the form; visibility and
-- required stay code-enforced for these blocks), their sections appear in the
-- Sections tab, and the VP-approval email templates become editable in the
-- Templates tab (same wording as the code fallbacks). Inserts a NEW config
-- version copied from the latest; existing keys win on merge so any manual
-- admin edits are preserved. Pure ASCII, dollar-quoted where needed.

insert into form_config (config_key, config_version, config_json, change_summary, updated_by)
select
  'paf_form',
  (select coalesce(max(config_version), 0) + 1 from form_config where config_key = 'paf_form'),
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          latest.config_json,
          '{lists,categories}',
          (
            case when (latest.config_json->'lists'->'categories') @> '["New Hire (Salary Leader)"]'::jsonb
              then latest.config_json->'lists'->'categories'
              else (latest.config_json->'lists'->'categories') || '["New Hire (Salary Leader)"]'::jsonb
            end
          ) ||
          (
            case when (latest.config_json->'lists'->'categories') @> '["Pay Adjustment (Salary)"]'::jsonb
              then '[]'::jsonb
              else '["Pay Adjustment (Salary)"]'::jsonb
            end
          )
        ),
        '{fields}',
        $f$
        {
          "nh_role":              {"label": "Role", "placeholder": "", "helpText": "GM, DO, or SDO being hired.", "required": true, "visible": true, "locked": true, "sections": ["new_hire"]},
          "nh_start_date":        {"label": "Start date", "placeholder": "", "helpText": "", "required": true, "visible": true, "locked": true, "sections": ["new_hire"]},
          "nh_hours_last_period": {"label": "Hours worked last pay period", "placeholder": "e.g. 80", "helpText": "", "required": true, "visible": true, "locked": true, "sections": ["new_hire"]},
          "nh_home_store":        {"label": "Home store", "placeholder": "", "helpText": "Required for a GM.", "required": false, "visible": true, "locked": true, "sections": ["new_hire"]},
          "nh_offer_letter_path": {"label": "Offer letter", "placeholder": "", "helpText": "Attach the signed offer letter.", "required": true, "visible": true, "locked": true, "sections": ["new_hire"]},
          "pa_role":              {"label": "Role", "placeholder": "", "helpText": "GM, DO, or SDO receiving the adjustment.", "required": true, "visible": true, "locked": true, "sections": ["pay_adjustment"]},
          "pa_new_salary":        {"label": "New salary (annual)", "placeholder": "e.g. 68000", "helpText": "", "required": true, "visible": true, "locked": true, "sections": ["pay_adjustment"]},
          "pa_start_date":        {"label": "New salary start date", "placeholder": "", "helpText": "", "required": true, "visible": true, "locked": true, "sections": ["pay_adjustment"]}
        }
        $f$::jsonb || (latest.config_json->'fields')
      ),
      '{sections}',
      latest.config_json->'sections' ||
      (
        case when (latest.config_json->'sections') @> '[{"key": "new_hire"}]'::jsonb
          then '[]'::jsonb
          else '[{"key": "new_hire", "title": "New Hire - Salary Leader", "description": "Role, identity, and pay-period details for a new salaried leader. Rendered by the form itself; labels and help text come from Fields.", "order": 90}]'::jsonb
        end
      ) ||
      (
        case when (latest.config_json->'sections') @> '[{"key": "pay_adjustment"}]'::jsonb
          then '[]'::jsonb
          else '[{"key": "pay_adjustment", "title": "Pay Adjustment - Salary", "description": "Salary change for a GM, DO, or SDO. SDO/RVP submit; the VP approves. Rendered by the form itself; labels and help text come from Fields.", "order": 91}]'::jsonb
      end
      )
    ),
    '{emailTemplates}',
    $t$
    {
      "PAY_ADJ_VP_APPROVAL_REQUEST": {"subject": "PAF needs your approval - {{EMPLOYEE}} ({{ROLE}} salary adjustment)", "body": "A Pay Adjustment (Salary) PAF needs your approval.\n\nEmployee: {{EMPLOYEE}}\nRole: {{ROLE}}\nNew salary: {{NEW_SALARY}}\nNew salary start date: {{START_DATE}}\nSubmitted by: {{SUBMITTER}}\n\nReview it in SOAR Hub under PAF."},
      "PAY_ADJ_VP_APPROVED": {"subject": "Pay adjustment approved - {{EMPLOYEE}}", "body": "{{APPROVER}} approved the salary pay adjustment for {{EMPLOYEE}} ({{ROLE}}).\nIt has moved to the Payroll queue."},
      "PAY_ADJ_VP_REJECTED": {"subject": "Pay adjustment rejected - {{EMPLOYEE}}", "body": "{{APPROVER}} rejected the salary pay adjustment for {{EMPLOYEE}} ({{ROLE}}).\n\nReason: {{REASON}}"}
    }
    $t$::jsonb || (latest.config_json->'emailTemplates')
  ),
  'Add salary categories (New Hire Salary Leader, Pay Adjustment Salary) to lists/fields/sections + VP approval email templates',
  'migration 0234'
from (
  select config_json from form_config
  where config_key = 'paf_form'
  order by config_version desc
  limit 1
) latest;

notify pgrst, 'reload schema';
