-- Migration 0065 — Self-serve / ad-hoc-startable workspace templates.
--
-- Up to now, a user could only fill a form/audit that had been
-- pre-assigned to them (either by the schedule sweeper or by an
-- editor). The renderer needed an assignment row to anchor the
-- submission. This blocks the "I'm doing a quality check right now,
-- let me start one" workflow that's the default in iAuditor /
-- SafetyCulture.
--
-- This migration adds an opt-in flag on the template. When true, any
-- workspace member with fill_assignment can ad-hoc-create their own
-- assignment (assignee = themselves, store = picked at start time,
-- status = in_progress) without needing it scheduled or hand-assigned.
-- Default off so existing templates keep their controlled rollout.

alter table workspace_templates
  add column is_self_serve boolean not null default false;

comment on column workspace_templates.is_self_serve is
  'When true, any workspace member with fill_assignment can self-start an assignment from this template at any time.';

create index workspace_templates_self_serve_idx
  on workspace_templates (workspace_id)
  where is_self_serve = true and is_archived = false;
