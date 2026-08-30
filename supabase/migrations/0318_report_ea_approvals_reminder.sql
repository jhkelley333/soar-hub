-- 0318_report_ea_approvals_reminder.sql
-- Daily "Employee Action approvals waiting" reminder (report engine 0297).
-- Handler lives in code (registry key 'employee_action_approvals_reminder').
-- Finds PTO + Training Credit requests still awaiting a decision and emails each
-- responsible approver a digest of the items in their queue, with how-to-approve
-- steps. Per-recipient fan-out, so recipients resolve at run time (definition
-- recipients stays empty). send_when_empty false — no email when nothing's
-- pending. An item drops off as soon as it's approved, so the nudge repeats
-- daily until actioned.
--
-- Ships ENABLED. Cron: every day 8:00 AM America/Chicago.
-- Upsert (on conflict do update) so re-running corrects an applied row.

insert into public.report_definitions (key, name, description, trigger_type, cron, timezone, enabled, recipients, send_when_empty)
values (
  'employee_action_approvals_reminder',
  'Employee Action approvals — daily reminder',
  'Daily: emails each approver the PTO + Training Credit requests awaiting their decision, with how-to-approve steps. Repeats until approved.',
  'schedule',
  '0 8 * * *',
  'America/Chicago',
  true,
  '[]'::jsonb,
  false
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
