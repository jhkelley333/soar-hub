-- supabase/migrations/0112_paf_new_hire_salary_leader.sql
--
-- Phase 1 of the "New Hire (Salary Leader)" PAF category. Adds the columns
-- unique to it. (last4_ssn, pay_period_end, employee_name, and notes/
-- explanation already exist on paf_submissions and are reused.)
--
-- Phase 2 will add the DO market (district) / SDO area pickers + the
-- auto-populated store list; the nh_home_store column below already covers
-- the GM case.

alter table paf_submissions
  add column if not exists nh_role             text,            -- 'GM' | 'DO' | 'SDO'
  add column if not exists nh_start_date       date,
  add column if not exists nh_hours_last_period numeric(6, 2),
  add column if not exists nh_home_store        text,           -- store number (GM)
  add column if not exists nh_no_market         boolean;        -- plus-one / in training

notify pgrst, 'reload schema';
