-- supabase/migrations/0091_employee_action_approvals.sql
--
-- Approval workflow for the Employee Action module.
--
-- Routing is by role + scope (no fixed assignee column): a request appears
-- in your queue when its current pending step matches your role AND the
-- store is in your user_visible_stores() set. Decisions are enforced in
-- netlify/functions/employee-actions.js and trailed in
-- employee_action_audit_log.
--
-- Status state machines:
--   training_credit_requests:
--     Submitted --approve(SDO|RVP)--> Approved
--     Submitted --reject---------->  Changes Requested --resubmit--> Submitted
--   pto_requests:
--     Submitted --approve(DO)-----> DO Approved --approve(SDO|RVP)--> Approved
--     (any step) --reject--------->  Changes Requested --resubmit--> Submitted
--
-- Either SDO or RVP can finalize (first action wins). Reject sends it back to
-- the submitter to edit and resubmit. Training-budget enforcement and PTO
-- balance tracking are deliberately out of scope here.
--
-- Idempotent.

-- Training Credit: single approval step (SDO/RVP).
alter table training_credit_requests
  add column if not exists approved_at       timestamptz,
  add column if not exists approved_by_id    uuid references profiles(id) on delete set null,
  add column if not exists approved_by_email text,
  add column if not exists decision_note     text,
  add column if not exists rejection_reason  text;

-- PTO: DO step, then SDO/RVP step.
alter table pto_requests
  add column if not exists do_approved_at    timestamptz,
  add column if not exists do_approved_by_id uuid references profiles(id) on delete set null,
  add column if not exists do_note           text,
  add column if not exists approved_at       timestamptz,
  add column if not exists approved_by_id    uuid references profiles(id) on delete set null,
  add column if not exists approved_by_email text,
  add column if not exists decision_note     text,
  add column if not exists rejection_reason  text;
