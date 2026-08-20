-- 0298_report_no_gm_credit.sql
-- Phase 2A: seed the "Monday no-GM credit" report definition on the engine
-- (0297). Handler lives in code (registry key 'monday_no_gm_credit'). Ships
-- disabled with no recipients so it never sends until an admin sets recipients
-- in /admin/reports and enables it. Cron: Mondays 7:00 AM America/Chicago.

insert into public.report_definitions (key, name, description, trigger_type, cron, timezone, enabled, recipients, send_when_empty)
values (
  'monday_no_gm_credit',
  'Monday: stores on no-GM credit',
  'Weekly Monday digest of stores that used the no-GM labor credit in the prior full week, grouped RVP -> DO -> store. Sent even when zero (good news).',
  'schedule', '0 7 * * 1', 'America/Chicago', false,
  '[]'::jsonb, true
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
