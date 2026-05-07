-- supabase/migrations/0018_paf_form_revisions.sql
--
-- Phase: PR B-2b — PAF form revisions + SDO bonus approval workflow.
--
-- Schema additions only; no destructive drops. Existing columns
-- (final_check_hrs, term_demotion, etc.) stay intact so historical
-- submissions remain readable. New PAF submissions stop populating the
-- removed fields; calcPafCost() drops final_check_hrs from the formula.
--
-- Idempotent.

alter table paf_submissions
  -- Shared employee attribute. Top-of-form toggle gates Reg Pay Rate
  -- across pay/leave/illness sections so Salary employees don't have
  -- to enter a rate they don't have.
  add column if not exists pay_basis text,

  -- Demotion (dedicated section, no longer entangled with Termination).
  -- Note: "current_role" is a reserved keyword in Postgres (built-in
  -- function returning the active DB role), so we use from_role.
  add column if not exists from_role text,
  add column if not exists new_role text,
  add column if not exists current_pay_rate numeric(10,2),
  add column if not exists new_pay_rate numeric(10,2),
  add column if not exists location_change boolean,
  add column if not exists new_location text,

  -- Transfer (dedicated section, separate from Cross Store Work).
  -- original_store + new_store already exist on the table from 0016;
  -- transfer reuses them and adds position columns + the pay rate
  -- columns above (shared with demotion).
  add column if not exists current_position text,
  add column if not exists new_position text,

  -- Bonus consolidation. spot_bonus_amt + bonus_type already exist;
  -- new sub-fields per bonus type let one row capture whichever flavor
  -- of bonus was submitted without forcing per-type tables.
  add column if not exists spot_bonus_reason text,
  add column if not exists training_bonus_amt numeric(10,2),
  add column if not exists trained_employee_name text,
  add column if not exists trained_at_store text,
  add column if not exists training_days integer,
  add column if not exists referral_bonus_amt numeric(10,2),
  add column if not exists referral_tier text,
  add column if not exists referred_employee_name text,
  add column if not exists referral_start_date date,

  -- SDO bonus approval workflow. status='Pending SDO Approval' is
  -- text-encoded (no enum), so no DDL needed for the value itself; the
  -- columns below capture who must decide and what they decided.
  add column if not exists sdo_approver_id uuid references profiles(id) on delete set null,
  add column if not exists sdo_decided_at timestamptz,
  add column if not exists sdo_decision text,         -- 'approved' | 'rejected'
  add column if not exists sdo_decision_note text;

create index if not exists paf_submissions_sdo_approver_idx
  on paf_submissions (sdo_approver_id)
  where archived = false and status = 'Pending SDO Approval';
