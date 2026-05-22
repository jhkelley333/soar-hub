-- Rollback for migration 0064 — workspace_submission_drafts.
-- Drops the drafts table. (Cascades aren't strictly needed since
-- nothing references it, but the explicit form is safer if any
-- ad-hoc views or grants were added later.)

drop table if exists workspace_submission_drafts cascade;
