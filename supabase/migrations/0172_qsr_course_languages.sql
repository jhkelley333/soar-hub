-- 0172_qsr_course_languages.sql
-- SOAR QSR — per-course language list for the learner language toggle.
-- Spanish (and any future language) is stored INLINE on each card under
-- data.i18n.<lang> (text overrides + a language-specific videoUrl), so a course
-- stays a single set of cards. This column just advertises which languages a
-- course has been translated into, so the player knows when to show the
-- EN/ES toggle. 'en' is always the base.

alter table qsr_courses
  add column if not exists languages text[] not null default '{en}';

notify pgrst, 'reload schema';
