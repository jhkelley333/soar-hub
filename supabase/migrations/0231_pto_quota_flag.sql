-- 0231_pto_quota_flag.sql
-- Vacation allowance: one week per calendar quarter (GM 5 days, hourly 40
-- hours) through the normal flow. Requests that push an employee over the
-- allowance are stamped over_quota at submit time and their FINAL approval
-- is restricted to RVP/admin. Pure ASCII.

alter table pto_requests
  add column if not exists over_quota boolean not null default false;

notify pgrst, 'reload schema';
