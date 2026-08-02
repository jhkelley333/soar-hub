-- 0270_cost_of_sales_label.sql
-- Relabel the Cost of Sales budget line to spell out that it is the total food
-- cost. Food Cost / Paper Cost sub-lines and the 27.6% target are unchanged —
-- this is wording only, and flows into the review flags + Budget & Targets UI.

update pl_budget_targets
  set label = 'Total Cost of Sales (Total Food Cost)'
  where line_key = 'cost_of_sales';

notify pgrst, 'reload schema';
