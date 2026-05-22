-- Rollback for 0063_workspace_template_sections.sql.
-- Drops section_id from questions + the sections table. section_label
-- on questions is untouched, so visual grouping continues to work
-- after rollback.

alter table workspace_template_questions
  drop column if exists section_id;

drop table if exists workspace_template_sections;
