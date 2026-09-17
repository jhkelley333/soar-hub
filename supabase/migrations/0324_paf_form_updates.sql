-- 0324_paf_form_updates.sql
-- Add pos_pay_difference and nh_locations columns; update form_config for
-- Promotion (Salary Leader) category and PTO "not for sick pay" description.

-- ── New columns ───────────────────────────────────────────────────────────────

ALTER TABLE paf_submissions
  ADD COLUMN IF NOT EXISTS pos_pay_difference NUMERIC,
  ADD COLUMN IF NOT EXISTS nh_locations       TEXT;

-- ── form_config updates ───────────────────────────────────────────────────────
-- 1. Append "Promotion (Salary Leader)" to the categories list (idempotent).
-- 2. Update the "leave" (PTO) section description to note it is not for sick pay.

UPDATE form_config
SET
  config_json = jsonb_set(
    jsonb_set(
      config_json,
      '{lists,categories}',
      (
        SELECT to_jsonb(array_agg(v ORDER BY ordinality))
        FROM (
          SELECT val AS v, row_number() OVER () AS ordinality
          FROM jsonb_array_elements_text(config_json->'lists'->'categories') AS val
          UNION ALL
          SELECT 'Promotion (Salary Leader)', 9999
          WHERE NOT (config_json->'lists'->'categories') @> '"Promotion (Salary Leader)"'::jsonb
        ) t
      )
    ),
    '{sections}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN (el->>'key') = 'leave'
          THEN el || '{"description":"PTO hours for the pay period. Note: this is not for sick pay — use the Illness category for sick leave."}'::jsonb
          ELSE el
        END
        ORDER BY (el->>'order')::int
      )
      FROM jsonb_array_elements(config_json->'sections') AS el
    )
  ),
  config_version = config_version + 1,
  change_summary  = 'Add Promotion (Salary Leader) category; PTO description — not for sick pay',
  updated_by      = 'migration-0324',
  updated_at      = NOW()
WHERE config_key = 'default';
