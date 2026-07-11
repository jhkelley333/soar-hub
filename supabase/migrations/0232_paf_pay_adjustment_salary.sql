-- 0232_paf_pay_adjustment_salary.sql
-- New PAF category: Pay Adjustment (Salary). SDO/RVP submit a salary change
-- for a GM/DO/SDO; the VP approves it (status Pending VP Approval, reusing
-- the SDO-approval columns), and VP + COO are copied on the emails. These
-- columns hold the category's custom fields. Pure ASCII.

alter table paf_submissions
  add column if not exists pa_role        text,
  add column if not exists pa_new_salary  numeric(12,2),
  add column if not exists pa_start_date  date;

notify pgrst, 'reload schema';
