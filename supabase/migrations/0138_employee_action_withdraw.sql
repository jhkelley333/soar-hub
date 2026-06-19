-- supabase/migrations/0138_employee_action_withdraw.sql
--
-- Adds a 'Withdrawn' lifecycle for Employee Actions (training credit + PTO):
-- when a request is no longer needed (e.g. the employee quit), a DO and above
-- can withdraw it instead of rejecting (a decision) or deleting (hides it).
--
-- 'Withdrawn' is just another value of the free-text `status` column (no CHECK
-- constraint exists), so no enum change is needed. This migration only adds a
-- column to record the optional reason for display + reporting. The who/when is
-- captured in employee_action_audit_log (action='withdraw'). Idempotent.

alter table training_credit_requests
  add column if not exists withdrawn_reason text;

alter table pto_requests
  add column if not exists withdrawn_reason text;

notify pgrst, 'reload schema';
