-- 0242_paf_cross_clock.sql
-- Cross Store Work asks: did the team member clock in at the other store?
-- Yes -> no additional pay is entered on the PAF (their hours pay through
-- the other store's clock); payroll is notified which store the OT charges
-- to via an auto-appended note. No -> the hours process as pay, as before.
-- Null for every other category and for historical Cross Store PAFs.

alter table paf_submissions
  add column if not exists cross_clocked_other boolean;

notify pgrst, 'reload schema';
