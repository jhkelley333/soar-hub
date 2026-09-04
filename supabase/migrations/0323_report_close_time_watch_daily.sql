-- 0323_report_close_time_watch_daily.sql
-- Daily Close-Time Watch report (report engine). Handler lives in code
-- (registry key 'close_time_watch_daily'). Compares each store's last clock-out
-- against its scheduled Hours-of-Operation close for the most recent captured
-- day, and emails each RVP their region's early closes (when there are any),
-- plus the definition's added addresses the full org-wide list every day.
-- Per-recipient fan-out, so recipients resolve at run time — RVPs are auto-
-- included by region; `recipients` holds the extra "added addresses".
--
-- Ships ENABLED. Cron: every day 8:00 AM America/Chicago. send_when_empty true
-- so the added addresses get a daily "all clear" too (RVPs are still only
-- emailed when their region has an early close). Add addresses in Admin →
-- Reports. Upsert so re-running corrects the row.

insert into public.report_definitions (key, name, description, trigger_type, cron, timezone, enabled, recipients, send_when_empty)
values (
  'close_time_watch_daily',
  'Close-Time Watch — daily',
  'Daily: stores whose last clock-out was before their scheduled close. Each RVP gets their region; added addresses get the org-wide list.',
  'schedule',
  '0 8 * * *',
  'America/Chicago',
  true,
  '[]'::jsonb,
  true
)
on conflict (key) do update set
  name            = excluded.name,
  description     = excluded.description,
  trigger_type    = excluded.trigger_type,
  cron            = excluded.cron,
  timezone        = excluded.timezone,
  enabled         = excluded.enabled,
  send_when_empty = excluded.send_when_empty;

notify pgrst, 'reload schema';
