-- 0174_qsr_required_training.sql
-- SOAR QSR — required ("pop up on login") training settings on a course.
-- An admin marks a course required on a cadence (e.g. quarterly) for a set of
-- roles (default: Shift Manager and above). On login, anyone in those roles who
-- hasn't completed it in the current fiscal quarter gets a reminder pop-up.
-- requirement_cadence NULL = not required.

alter table qsr_courses
  add column if not exists requirement_cadence text,                       -- null | 'quarterly' | 'annual'
  add column if not exists requirement_roles   text[] not null default '{}';

notify pgrst, 'reload schema';
