-- 0178_log_offline_work.sql
-- Support recording work a store had done WITHOUT a work-order ticket (an
-- off-system job). These land in the tickets table as completed/closed work
-- orders flagged is_logged_offline, with the invoice attached — so the vendor
-- and cost are captured for history and future outreach. service_date is when
-- the work was actually performed (distinct from date_submitted = logged-at).

alter table tickets
  add column if not exists is_logged_offline boolean not null default false,
  add column if not exists service_date date;

notify pgrst, 'reload schema';
