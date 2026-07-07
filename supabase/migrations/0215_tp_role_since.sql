-- 0215_tp_role_since.sql
-- Track when a member entered their CURRENT role, so "time in role" is a real
-- number (distinct from company tenure = hire_date). Backfilled from hire_date
-- for existing rows; stamped to today whenever the role changes going forward
-- (manual promote/demote + commit-plan promotions).

alter table tp_team_members add column if not exists role_since date;

-- Seed existing rows: best available proxy is their hire date.
update tp_team_members set role_since = hire_date::date
where role_since is null and hire_date is not null;

notify pgrst, 'reload schema';
