-- Rollback for 0052_preventive_maintenance.sql.
-- Drops PM tables + the tickets.pm_schedule_id column. The trigger
-- function is removed too, since nothing else uses it.
-- Order matters: drop the FK column before the parent table.

alter table tickets drop column if exists pm_schedule_id;

drop table if exists pm_schedule;
drop table if exists pm_templates;
drop function if exists pm_touch_updated_at();

notify pgrst, 'reload schema';
