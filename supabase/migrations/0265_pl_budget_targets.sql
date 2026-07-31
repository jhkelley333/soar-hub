-- 0265_pl_budget_targets.sql
-- Editable P&L budget / target table for store-controllable lines (% of sales).
-- One row per line; group rows carry the rollup target. verify_on_zero marks a
-- line that should prompt a "did this actually happen?" check when it comes in
-- at $0 on a prelim (e.g. Pest Control — confirm a visit occurred). Admin edits
-- the targets; the P&L review flags each store's actuals against them.
-- Service-role gated: RLS on, no policies. Seed = P6 company budget.

create table if not exists pl_budget_targets (
  line_key       text        primary key,
  label          text        not null,
  group_key      text,                        -- parent group_key; null for group rows / standalone
  is_group       boolean     not null default false,
  target_pct     numeric(6,3),                -- % of sales
  verify_on_zero boolean     not null default false,
  sort_order     int         not null default 0,
  updated_by     uuid        references profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);

alter table pl_budget_targets enable row level security;

insert into pl_budget_targets (line_key, label, group_key, is_group, target_pct, verify_on_zero, sort_order) values
  ('cost_of_sales',        'Cost of Sales (Food + Paper)', null,             true,  27.600, false, 10),
  ('food_cost',            'Food Cost',                    'cost_of_sales',  false, 24.600, false, 11),
  ('paper_cost',           'Paper Cost',                   'cost_of_sales',  false,  3.000, false, 12),
  ('total_labor',          'Total Labor (Payroll)',        null,             true,  26.600, false, 20),
  ('salaried_managers',    'Salaried Managers',            'total_labor',    false,  4.900, false, 21),
  ('hourly_wages',         'Hourly Wages',                 'total_labor',    false, 18.500, false, 22),
  ('overtime',             'Overtime (OT)',                'total_labor',    false,  0.500, false, 23),
  ('rm',                   'R&M (Repair & Maintenance)',   null,             false,  0.750, false, 30),
  ('total_controllable',   'Total Controllable Expenses',  null,             true,   2.400, false, 40),
  ('smallwares',           'Smallwares',                   'total_controllable', false, 0.150, false, 41),
  ('uniforms',             'Uniforms',                     'total_controllable', false, 0.150, false, 42),
  ('cleaning_solutions',   'Cleaning Solutions',           'total_controllable', false, 0.400, false, 43),
  ('trash_removal',        'Trash Removal',                'total_controllable', false, 0.420, false, 44),
  ('landscaping_snow',     'Landscaping / Snow',           'total_controllable', false, 0.270, false, 45),
  ('supplies_other',       'Supplies Other',               'total_controllable', false, 0.500, false, 46),
  ('grease_trap',          'Grease Trap',                  'total_controllable', false, 0.180, false, 47),
  ('professional_services','Professional Services',        'total_controllable', false, 0.110, false, 48),
  ('travel_expense',       'Travel Expense',               'total_controllable', false, 0.160, false, 49),
  ('pest_control',         'Pest Control',                 'total_controllable', false, 0.070, true,  50)
on conflict (line_key) do nothing;

notify pgrst, 'reload schema';
