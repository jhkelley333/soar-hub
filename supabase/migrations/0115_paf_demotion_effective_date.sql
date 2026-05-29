-- supabase/migrations/0115_paf_demotion_effective_date.sql
--
-- Demotion category: capture the effective date of the new (demoted) role.

alter table paf_submissions
  add column if not exists demotion_effective_date date;

notify pgrst, 'reload schema';
