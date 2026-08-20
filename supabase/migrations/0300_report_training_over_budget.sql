-- 0300_report_training_over_budget.sql
-- Phase 2D: seed the "training credit over budget" EVENT report. Fired inline
-- from the training-credit approval in employee-actions.js when an approved
-- amount overdraws the store's yearly training bank. Handler lives in code
-- (registry key 'training_over_budget'). Role-based recipient (COO), not a
-- hardcoded name. Enabled so the event actually sends once it exists.

insert into public.report_definitions (key, name, description, trigger_type, cron, timezone, enabled, recipients, send_when_empty)
values (
  'training_over_budget',
  'Event: training credit over budget',
  'Fires when a training credit is approved for more than the store''s remaining yearly training bank. Emails the COO with store, requester, amount, budget remaining, and overage.',
  'event', null, 'America/Chicago', true,
  '[{"mode":"role","value":"coo"}]'::jsonb, false
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
