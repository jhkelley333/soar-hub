-- supabase/migrations/0059_rollback.sql
--
-- Reverses 0059_workspace_templates.sql. Drops the four new tables
-- and their policies, and removes the tightened action CHECK on
-- workspace_activity_log (returns action to free text per 0058).
--
-- Phase 0060 references workspace_template_versions — roll that
-- back first if applied.

drop policy if exists workspace_template_approval_steps_select on public.workspace_template_approval_steps;
drop policy if exists workspace_template_questions_select      on public.workspace_template_questions;
drop policy if exists workspace_template_versions_select       on public.workspace_template_versions;
drop policy if exists workspace_templates_select               on public.workspace_templates;

drop trigger if exists workspace_templates_set_updated_at_trg on public.workspace_templates;

alter table public.workspace_activity_log
  drop constraint if exists workspace_activity_log_action_check;

drop table if exists public.workspace_template_approval_steps;
drop table if exists public.workspace_template_questions;
drop table if exists public.workspace_template_versions;
drop table if exists public.workspace_templates;

notify pgrst, 'reload schema';
