-- supabase/migrations/0062_workspace_deleted_action.sql
--
-- Tiny migration to extend workspace_activity_log.action CHECK with
-- 'workspace.deleted'. Used by the deleteWorkspace endpoint to write
-- a final orphan log row (workspace_id = NULL) just before hard-
-- deleting a workspace, so the deletion event survives the cascade
-- even though the deleted workspace's child log entries do not.
--
-- 0061 enumerated 51 actions; 0062 adds 1 → 52 total.
--
-- Rollback: see 0062_rollback.sql.

alter table public.workspace_activity_log
  drop constraint if exists workspace_activity_log_action_check;

alter table public.workspace_activity_log
  add constraint workspace_activity_log_action_check check (action in (
    -- workspace lifecycle
    'workspace.created','workspace.updated','workspace.archived','workspace.unarchived','workspace.deleted',
    -- membership
    'member.added','member.role_changed','member.removed',
    -- template lifecycle
    'template.created','template.updated','template.archived','template.unarchived',
    -- template version lifecycle
    'template_version.created','template_version.published','template_version.archived',
    'template_version.questions_changed','template_version.approval_steps_changed',
    -- schedules
    'schedule.created','schedule.updated','schedule.disabled','schedule.enabled','schedule.spawned',
    -- assignments
    'assignment.created','assignment.cancelled','assignment.started','assignment.submitted','assignment.marked_overdue',
    -- submissions
    'submission.created','submission.locked','submission.unlocked','submission.revision_created',
    -- signoffs
    'signoff.approved','signoff.rejected','signoff.revision_requested','signoff.skipped',
    -- attachments
    'attachment.uploaded','attachment.deleted',
    -- CAPs
    'cap.created','cap.assigned','cap.started','cap.verified','cap.closed','cap.reopened','cap.due_date_changed',
    -- CAP proofs
    'cap_proof.submitted','cap_proof.accepted','cap_proof.rejected',
    -- repeat findings
    'repeat_finding.detected','repeat_finding.acknowledged','repeat_finding.reset',
    -- automations
    'automation.created','automation.updated','automation.disabled','automation.enabled','automation.fired'
  ));

notify pgrst, 'reload schema';
