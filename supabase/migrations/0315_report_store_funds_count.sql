-- 0315_report_store_funds_count.sql
-- Monday "Store Funds" (Bank) validation compliance report (report engine 0297).
-- Handler lives in code (registry key 'monday_store_funds_count'). DOs validate
-- each store's on-hand cash Bank in week 1 of every 4-week period; for the
-- current fiscal period this report lists the stores STILL DUE (Bank not yet
-- validated) plus any OVER TOLERANCE, grouped RVP -> DO, so COO + RVPs can chase
-- them — mirroring the Cash Management → Store Funds tab.
--
-- Ships ENABLED with recipients (unlike the earlier reports, which shipped off)
-- because it was requested to go out on Mondays to the COO and RVPs. Cron:
-- Mondays 7:00 AM America/Chicago. send_when_empty true — a Monday "all Banks
-- validated" pulse is worth sending.
--
-- Upsert (on conflict do update) so re-running corrects an already-applied row.

insert into public.report_definitions (key, name, description, trigger_type, cron, timezone, enabled, recipients, send_when_empty)
values (
  'monday_store_funds_count',
  'Store Funds — weekly Bank validation',
  'Mondays: stores whose Bank is not yet validated this fiscal period (plus any over tolerance), grouped RVP → DO. Chase the gaps in Cash Management → Store Funds.',
  'schedule',
  '0 7 * * 1',
  'America/Chicago',
  true,
  '[{"mode":"role","value":"coo"},{"mode":"role","value":"rvp"}]'::jsonb,
  true
)
on conflict (key) do update set
  name            = excluded.name,
  description     = excluded.description,
  trigger_type    = excluded.trigger_type,
  cron            = excluded.cron,
  timezone        = excluded.timezone,
  enabled         = excluded.enabled,
  recipients      = excluded.recipients,
  send_when_empty = excluded.send_when_empty;

notify pgrst, 'reload schema';
