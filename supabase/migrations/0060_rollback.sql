-- supabase/migrations/0060_rollback.sql
--
-- Reverses 0060_workspace_submissions.sql. Drops the six new tables,
-- their policies + triggers, the submission lock function, the
-- storage bucket, and the storage.objects policy. Returns
-- workspace_activity_log.action CHECK to the 0059 vocabulary.
--
-- WARNING: removes the workspace-attachments bucket AND any files in
-- it. Backend should drain the bucket first if rolling back in prod.
--
-- Phase 0061 references workspace_submissions + workspace_submission_answers
-- (for CAPs) — roll that back first if applied.

-- Storage policy first (depends on the bucket existing):
drop policy if exists workspace_attachments_storage_select on storage.objects;

-- Table policies:
drop policy if exists workspace_attachments_select           on public.workspace_attachments;
drop policy if exists workspace_submission_signoffs_select   on public.workspace_submission_signoffs;
drop policy if exists workspace_submission_answers_select    on public.workspace_submission_answers;
drop policy if exists workspace_submissions_select           on public.workspace_submissions;
drop policy if exists workspace_assignments_select           on public.workspace_assignments;
drop policy if exists workspace_schedules_select             on public.workspace_schedules;

-- Triggers + lock function:
drop trigger if exists workspace_submissions_enforce_lock_trg on public.workspace_submissions;
drop function if exists public.workspace_submissions_enforce_lock();
drop trigger if exists workspace_schedules_set_updated_at_trg on public.workspace_schedules;

-- Revert activity_log action CHECK to the 0059 vocabulary:
alter table public.workspace_activity_log
  drop constraint if exists workspace_activity_log_action_check;
alter table public.workspace_activity_log
  add constraint workspace_activity_log_action_check check (action in (
    'workspace.created','workspace.updated','workspace.archived','workspace.unarchived',
    'member.added','member.role_changed','member.removed',
    'template.created','template.updated','template.archived','template.unarchived',
    'template_version.created','template_version.published','template_version.archived',
    'template_version.questions_changed','template_version.approval_steps_changed'
  ));

-- Tables (cascade clears FKs):
drop table if exists public.workspace_attachments;
drop table if exists public.workspace_submission_signoffs;
drop table if exists public.workspace_submission_answers;
drop table if exists public.workspace_submissions;
drop table if exists public.workspace_assignments;
drop table if exists public.workspace_schedules;

-- Storage bucket (silently removes files in it):
delete from storage.buckets where id = 'workspace-attachments';

notify pgrst, 'reload schema';
