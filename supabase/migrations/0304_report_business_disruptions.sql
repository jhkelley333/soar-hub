-- 0304_report_business_disruptions.sql
-- Seed the "weekly business disruptions (prior week)" report definition on the
-- report engine (0297). Handler lives in code (registry key
-- 'weekly_business_disruptions'). Ships disabled with no recipients until an
-- admin sets recipients in /admin/reports and enables it. Cron: Mondays 7:00 AM
-- America/Chicago. send_when_empty true — a weekly "all clear" pulse is worth
-- sending even when nothing happened.

insert into public.report_definitions (key, name, description, trigger_type, cron, timezone, enabled, recipients, send_when_empty)
values (
  'weekly_business_disruptions',
  'Monday: business disruptions (prior week)',
  'Weekly digest of store closures / business disruptions with a disruption_date in the prior full week, grouped RVP -> DO -> store, with report count, stores still closed, and estimated lost sales. Sent even when zero (all-clear).',
  'schedule', '0 7 * * 1', 'America/Chicago', false,
  '[]'::jsonb, true
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
