-- 0299_report_training_credits.sql
-- Phase 2B: seed the "weekly training credits used" report definition. Handler
-- lives in code (registry key 'weekly_training_credits'). Ships disabled with no
-- recipients until an admin configures it in /admin/reports. Cron: Mondays
-- 7:00 AM America/Chicago. send_when_empty false (no credits used -> no email).

insert into public.report_definitions (key, name, description, trigger_type, cron, timezone, enabled, recipients, send_when_empty)
values (
  'weekly_training_credits',
  'Monday: training credits used (prior week)',
  'Grand total + by-store detail (RVP -> DO -> store) of training credits approved in the prior full week. Not sent when nothing was used.',
  'schedule', '0 7 * * 1', 'America/Chicago', false,
  '[]'::jsonb, false
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
