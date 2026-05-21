-- supabase/migrations/0061_rollback.sql
--
-- Reverses 0061_workspace_audits.sql. Drops the four new tables,
-- their policies + triggers, and reverts workspace_activity_log.action
-- CHECK to the 0060 vocabulary (35 actions).

drop policy if exists workspace_automations_select       on public.workspace_automations;
drop policy if exists workspace_repeat_findings_select   on public.workspace_repeat_findings;
drop policy if exists workspace_cap_proofs_select        on public.workspace_cap_proofs;
drop policy if exists workspace_caps_select              on public.workspace_corrective_action_plans;

drop trigger if exists workspace_automations_set_updated_at_trg on public.workspace_automations;
drop trigger if exists workspace_caps_set_updated_at_trg        on public.workspace_corrective_action_plans;

-- Revert activity_log action CHECK to the 0060 vocabulary:
alter table public.workspace_activity_log
  drop constraint if exists workspace_activity_log_action_check;
alter table public.workspace_activity_log
  add constraint workspace_activity_log_action_check check (action in (
    'workspace.created','workspace.updated','workspace.archived','workspace.unarchived',
    'member.added','member.role_changed','member.removed',
    'template.created','template.updated','template.archived','template.unarchived',
    'template_version.created','template_version.published','template_version.archived',
    'template_version.questions_changed','template_version.approval_steps_changed',
    'schedule.created','schedule.updated','schedule.disabled','schedule.enabled','schedule.spawned',
    'assignment.created','assignment.cancelled','assignment.started','assignment.submitted','assignment.marked_overdue',
    'submission.created','submission.locked','submission.unlocked','submission.revision_created',
    'signoff.approved','signoff.rejected','signoff.revision_requested','signoff.skipped',
    'attachment.uploaded','attachment.deleted'
  ));

drop table if exists public.workspace_automations;
drop table if exists public.workspace_repeat_findings;
drop table if exists public.workspace_cap_proofs;
drop table if exists public.workspace_corrective_action_plans;

notify pgrst, 'reload schema';
