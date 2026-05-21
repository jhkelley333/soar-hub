-- supabase/migrations/0062_rollback.sql
--
-- Reverts 0062 by reinstating the 0061 51-action CHECK.
-- WARNING: if any workspace_activity_log rows already carry
-- action = 'workspace.deleted', this migration will fail when
-- the CHECK is recreated. Clear those rows first:
--
--   delete from workspace_activity_log where action = 'workspace.deleted';

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
    'attachment.uploaded','attachment.deleted',
    'cap.created','cap.assigned','cap.started','cap.verified','cap.closed','cap.reopened','cap.due_date_changed',
    'cap_proof.submitted','cap_proof.accepted','cap_proof.rejected',
    'repeat_finding.detected','repeat_finding.acknowledged','repeat_finding.reset',
    'automation.created','automation.updated','automation.disabled','automation.enabled','automation.fired'
  ));

notify pgrst, 'reload schema';
