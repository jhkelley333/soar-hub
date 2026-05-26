-- supabase/migrations/0092_employee_action_tracking.sql
--
-- Post-approval tracking for the Employee Action module.
--
-- After a request is approved there are manual external steps that each need
-- a confirmation, modeled as follow-on statuses:
--
--   training_credit_requests:
--     Approved --(SDO/RVP marks entered in tracking sheet)--> Entered
--     Entered  --(DO completes the closeout form after last day)--> Closed Out
--   pto_requests:
--     Approved --(DO confirms the vacation PAF was submitted)--> PAF Submitted
--
-- The DO closeout alert is event-triggered (fired when the SDO/RVP marks the
-- training entered) — no scheduled job. last_day_date records the final
-- training day so the closeout reminder/UI can show when it's due.
--
-- Idempotent.

alter table training_credit_requests
  add column if not exists last_day_date   date,
  add column if not exists entered_at      timestamptz,
  add column if not exists entered_by_id   uuid references profiles(id) on delete set null,
  add column if not exists closed_out_at   timestamptz,
  add column if not exists closed_out_by_id uuid references profiles(id) on delete set null;

alter table pto_requests
  add column if not exists paf_submitted_at    timestamptz,
  add column if not exists paf_submitted_by_id uuid references profiles(id) on delete set null;
