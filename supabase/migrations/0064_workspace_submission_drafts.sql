-- Migration 0064 — Workspace SUBMISSION DRAFTS.
--
-- Lets the renderer auto-save in-progress answers so a user can close
-- the tab / lose connection / pick up later without losing work. One
-- row per (assignment_id, user_id). The draft is deleted on a
-- successful submit by the backend; the frontend also clears its
-- localStorage mirror.
--
-- template_version_id is snapshotted at save time so the renderer can
-- detect a republish: if the assignment's current pinned version no
-- longer matches the draft's version_id, we force the user to restart
-- (scoring rules + questions may have changed under them).
--
-- last-write-wins reconciliation is handled in the backend by
-- comparing client_updated_at against the row's existing value — a
-- save with an older timestamp is a no-op (a second tab/device has a
-- more recent edit and we shouldn't clobber it).

create table workspace_submission_drafts (
  id                  uuid        primary key default gen_random_uuid(),
  assignment_id       uuid        not null references workspace_assignments(id) on delete cascade,
  template_version_id uuid        not null references workspace_template_versions(id) on delete cascade,
  user_id             uuid        not null references profiles(id) on delete cascade,
  answers             jsonb       not null default '[]'::jsonb,
  client_updated_at   timestamptz not null,
  last_saved_at       timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (assignment_id, user_id)
);

comment on table workspace_submission_drafts is
  'In-progress form answers for an assignment, autosaved by the renderer. Deleted on submit.';
comment on column workspace_submission_drafts.template_version_id is
  'Snapshot at save time. If the assignment now points to a different version, the draft is stale.';
comment on column workspace_submission_drafts.client_updated_at is
  'When the client last mutated answers. Used for last-write-wins between tabs/devices.';

create index workspace_submission_drafts_user_idx
  on workspace_submission_drafts (user_id, last_saved_at desc);
