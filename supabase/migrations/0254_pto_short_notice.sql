-- 0254_pto_short_notice.sql
-- Allow PTO requests inside the 30-day window instead of blocking them. Such a
-- request is stamped short_notice = true; it still runs the normal DO → SDO/RVP
-- flow, but is flagged so an SDO or RVP knows to approve it deliberately.

alter table pto_requests
  add column if not exists short_notice boolean not null default false;

notify pgrst, 'reload schema';
