-- 0315_report_store_funds_count.sql
-- Monday "Store Funds Count" compliance report (report engine 0297). Handler
-- lives in code (registry key 'monday_store_funds_count'). For the current
-- fiscal period it lists stores MISSING nightly cash counts in Cash Management,
-- grouped RVP -> DO, so COO + RVPs can chase the gaps.
--
-- Ships ENABLED with recipients (unlike the earlier reports, which shipped off)
-- because it was requested to go out on Mondays to the COO and RVPs. Cron:
-- Mondays 7:00 AM America/Chicago. send_when_empty true — a Monday "all stores
-- current" pulse is worth sending.

insert into public.report_definitions (key, name, description, trigger_type, cron, timezone, enabled, recipients, send_when_empty)
values (
  'monday_store_funds_count',
  'Store Funds Count — weekly compliance',
  'Mondays: stores missing nightly cash counts this fiscal period, grouped RVP → DO. Chase the gaps in Cash Management.',
  'schedule',
  '0 7 * * 1',
  'America/Chicago',
  true,
  '[{"mode":"role","value":"coo"},{"mode":"role","value":"rvp"}]'::jsonb,
  true
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
