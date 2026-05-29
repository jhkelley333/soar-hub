-- supabase/migrations/0116_paf_drivein_na.sql
--
-- Demotion: let SDO-and-higher submitters waive the Drive-In # when the
-- demoted leader is a district/area-level role with no single store.
-- `drive_in` is now nullable in practice (we store null when waived);
-- `drivein_na` records that the waiver was used.

alter table paf_submissions
  add column if not exists drivein_na boolean not null default false;

-- Drive-In # can now be absent: waived demotions and New Hire (Salary
-- Leader) PAFs (which use a home store / market instead) carry no single
-- store number.
alter table paf_submissions
  alter column drive_in drop not null;

notify pgrst, 'reload schema';
