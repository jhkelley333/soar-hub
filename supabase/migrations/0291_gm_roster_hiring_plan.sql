-- 0291_gm_roster_hiring_plan.sql
-- For an OPEN store on the GM roster: capture the hiring plan — a projected
-- fill date and who's filling it, or a "still interviewing" flag.

alter table gm_roster add column if not exists projected_gm_name  text;
alter table gm_roster add column if not exists projected_fill_date text;
alter table gm_roster add column if not exists still_interviewing  boolean not null default false;

notify pgrst, 'reload schema';
