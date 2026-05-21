-- supabase/migrations/0060_workspace_submissions.sql
--
-- Phase 3 of 4 for the Workspace feature. Adds the runtime layer:
-- scheduling, assignment, submission, sign-off, and file attachments.
-- After this phase, the feature is functional for forms; phase 0061
-- adds the audit-only specifics (CAPs, repeat detection, automations).
--
-- Depends on 0058 (workspaces, workspace_activity_log) and 0059
-- (templates + versions + questions + approval_steps).
--
-- Tables:
--   workspace_schedules            recurring assignment generation rules
--   workspace_assignments          a TODO instance for a user at a store
--   workspace_submissions          immutable filled-out response
--   workspace_submission_answers   one row per (submission, question)
--   workspace_submission_signoffs  per-step approval state
--   workspace_attachments          generic file table (photos, sigs,
--                                  CAP proofs, documents)
--
-- Submission immutability:
--   - Submissions insert with is_locked = true.
--   - A BEFORE UPDATE trigger refuses changes to all columns EXCEPT
--     signoff_status and is_locked itself. Backend has to explicitly
--     unlock to make any other change (rare; admin correction).
--   - Revisions create a NEW submission row, chained via
--     parent_submission_id. The latest revision = the one with no
--     child pointing at it.
--
-- Storage:
--   - New PRIVATE bucket `workspace-attachments`. Differs from
--     wo2-ticket-photos (public) on purpose — these are compliance
--     artifacts (audit evidence, signatures, CAP proofs) that should
--     not be publicly fetchable. Backend serves via signed URLs.
--
-- Activity-log vocabulary extended with submission/assignment/
-- schedule/attachment actions (16 new entries).
--
-- Rollback: see 0060_rollback.sql.

-- ============================================================
-- TABLE: workspace_schedules
--
-- Recurring assignment generation. A scheduled Netlify function
-- (every 15 min) reads rows where next_spawn_at <= now() and
-- is_active = true, spawns workspace_assignments rows according to
-- the assignee_rule DSL, then bumps next_spawn_at.
--
-- Cadence + day fields:
--   daily        — spawn every day at spawn_time
--   weekly       — spawn on day_of_week at spawn_time
--   biweekly     — spawn every other week on day_of_week
--   monthly      — spawn on day_of_month at spawn_time
--   quarterly    — spawn on day_of_month of the 1st month of each
--                  quarter (Jan/Apr/Jul/Oct)
--
-- day_of_month is capped at 28 to dodge month-edge issues (e.g.
-- "schedule on the 31st" → ambiguous in Feb).
--
-- assignee_rule JSON DSL examples:
--   { "kind": "fixed", "user_id": "<uuid>" }
--   { "kind": "role_relative", "role": "gm", "anchor": "scope_anchor" }
--     (the workspace's scope_anchor; one assignment per matching user)
--   { "kind": "per_store", "scope_kind": "area", "scope_id": "<uuid>",
--     "role_in_store": "gm" }
--     (one assignment per store under that scope, assigned to the
--     store's role-holder)
-- ============================================================
create table if not exists public.workspace_schedules (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references public.workspaces(id) on delete cascade,
  template_id     uuid        not null references public.workspace_templates(id) on delete cascade,
  cadence         text        not null
                              check (cadence in ('daily','weekly','biweekly','monthly','quarterly')),
  day_of_week     int         check (day_of_week is null or (day_of_week between 0 and 6)),
  day_of_month    int         check (day_of_month is null or (day_of_month between 1 and 28)),
  spawn_time      text        not null default '08:00',
  spawn_tz        text        not null default 'America/Chicago',
  assignee_rule   jsonb       not null,
  due_after_hours int         not null default 24 check (due_after_hours > 0),
  is_active       boolean     not null default true,
  last_spawned_at timestamptz,
  next_spawn_at   timestamptz,
  created_by_id   uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists workspace_schedules_due_idx
  on public.workspace_schedules (next_spawn_at) where is_active = true;
create index if not exists workspace_schedules_workspace_idx
  on public.workspace_schedules (workspace_id, is_active);

-- ============================================================
-- TABLE: workspace_assignments
--
-- An instance of "fill out this template by this date". Either
-- ad-hoc (created manually) or spawned by a schedule. status moves:
--   pending      → in_progress → submitted
--                              → overdue (set by sweeper)
--                              → cancelled (manual)
--
-- store_id is nullable globally; the app enforces "required for
-- audits, optional for forms" since the question is template-shape-
-- dependent and we don't want a join in a CHECK constraint.
-- ============================================================
create table if not exists public.workspace_assignments (
  id                    uuid        primary key default gen_random_uuid(),
  workspace_id          uuid        not null references public.workspaces(id) on delete cascade,
  template_id           uuid        not null references public.workspace_templates(id) on delete cascade,
  -- Pin to a specific version so the assignment can't be rug-pulled
  -- by a template edit between spawn and submit:
  template_version_id   uuid        not null references public.workspace_template_versions(id),
  schedule_id           uuid        references public.workspace_schedules(id) on delete set null,
  assignee_id           uuid        not null references public.profiles(id) on delete restrict,
  store_id              uuid        references public.stores(id) on delete restrict,
  status                text        not null default 'pending'
                                    check (status in ('pending','in_progress','submitted','overdue','cancelled')),
  due_at                timestamptz,
  started_at            timestamptz,
  cancelled_at          timestamptz,
  cancelled_by_id       uuid        references public.profiles(id) on delete set null,
  created_by_id         uuid        references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists workspace_assignments_assignee_idx
  on public.workspace_assignments (assignee_id, status);
create index if not exists workspace_assignments_store_idx
  on public.workspace_assignments (store_id, status) where store_id is not null;
create index if not exists workspace_assignments_due_idx
  on public.workspace_assignments (due_at) where status in ('pending','in_progress');
create index if not exists workspace_assignments_workspace_idx
  on public.workspace_assignments (workspace_id, status);

-- ============================================================
-- TABLE: workspace_submissions
--
-- Immutable filled-out response. Locks on insert via the
-- workspace_submissions_enforce_lock trigger; only signoff_status
-- and is_locked are mutable thereafter.
--
-- Revisions chain via parent_submission_id (the previous version).
-- version_number monotonically increases. The "current" submission
-- for an assignment = the row whose id appears as no other row's
-- parent_submission_id (i.e. nothing is descended from it).
--
-- Audit-scoring columns are computed by the backend at submit time
-- (after evaluating each answer). Null for type='form' submissions.
-- ============================================================
create table if not exists public.workspace_submissions (
  id                     uuid        primary key default gen_random_uuid(),
  assignment_id          uuid        not null references public.workspace_assignments(id) on delete restrict,
  template_version_id    uuid        not null references public.workspace_template_versions(id),
  submitted_by_id        uuid        references public.profiles(id) on delete set null,
  submitted_at           timestamptz not null default now(),

  -- Revision chain. Original has parent = NULL; revisions point
  -- at their immediate predecessor.
  parent_submission_id   uuid        references public.workspace_submissions(id),
  version_number         int         not null default 1 check (version_number >= 1),
  revision_reason        text,

  -- Audit scoring (null for form-type submissions):
  audit_score_total      numeric(8,2),
  audit_score_possible   numeric(8,2),
  audit_score_percent    numeric(5,2)
                         check (audit_score_percent is null
                           or (audit_score_percent >= 0 and audit_score_percent <= 100)),
  audit_critical_failed  boolean,
  audit_outcome          text        check (audit_outcome is null
                                       or audit_outcome in ('pass','fail','fail_critical')),

  -- Approval lifecycle on this submission:
  signoff_status         text        not null default 'pending_review'
                                     check (signoff_status in (
                                       'pending_review','in_review','approved',
                                       'rejected','revision_requested'
                                     )),

  -- Lock flag. True on insert; trigger refuses updates to most
  -- columns while true. Admin sets to false explicitly for the
  -- rare correction case.
  is_locked              boolean     not null default true
);

create index if not exists workspace_submissions_assignment_idx
  on public.workspace_submissions (assignment_id, version_number desc);
create index if not exists workspace_submissions_submitter_idx
  on public.workspace_submissions (submitted_by_id, submitted_at desc)
  where submitted_by_id is not null;
create index if not exists workspace_submissions_signoff_idx
  on public.workspace_submissions (signoff_status)
  where signoff_status in ('pending_review','in_review','revision_requested');
create index if not exists workspace_submissions_parent_idx
  on public.workspace_submissions (parent_submission_id)
  where parent_submission_id is not null;

-- Submission lock trigger. Allows updates to signoff_status and
-- is_locked only while is_locked = true. Once unlocked (by admin
-- correction), all columns become mutable; the backend should
-- re-lock after applying corrections.
create or replace function public.workspace_submissions_enforce_lock()
returns trigger
language plpgsql
as $$
begin
  if old.is_locked = true then
    if new.assignment_id          is distinct from old.assignment_id
       or new.template_version_id is distinct from old.template_version_id
       or new.submitted_by_id     is distinct from old.submitted_by_id
       or new.submitted_at        is distinct from old.submitted_at
       or new.parent_submission_id is distinct from old.parent_submission_id
       or new.version_number      is distinct from old.version_number
       or new.revision_reason     is distinct from old.revision_reason
       or new.audit_score_total   is distinct from old.audit_score_total
       or new.audit_score_possible is distinct from old.audit_score_possible
       or new.audit_score_percent is distinct from old.audit_score_percent
       or new.audit_critical_failed is distinct from old.audit_critical_failed
       or new.audit_outcome       is distinct from old.audit_outcome then
      raise exception 'workspace_submissions: row is locked. Only signoff_status and is_locked may be updated; unlock first via backend.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_submissions_enforce_lock_trg on public.workspace_submissions;
create trigger workspace_submissions_enforce_lock_trg
  before update on public.workspace_submissions
  for each row
  execute function public.workspace_submissions_enforce_lock();

-- ============================================================
-- TABLE: workspace_submission_answers
--
-- One row per (submission, question). Typed columns instead of
-- single JSONB so simple reporting + indexing works. The right
-- column to read depends on the question's field_type:
--   short_text, long_text       → answer_text
--   number                       → answer_number
--   checkbox                     → answer_boolean
--   date                         → answer_date
--   select_one, select_many,
--     pass_fail_na, signature    → answer_json
--   photo, file                  → attachment_ids
--
-- Audit-specific computed at submit time:
--   audit_result        'pass' / 'fail' / 'na' (null for forms)
--   audit_was_critical  snapshot of question.is_critical so we can
--                       reason about the audit outcome without
--                       re-joining template_questions.
--
-- Geo + captured_at recorded on photo answers when the EXIF data
-- (or device geolocation API at capture time) is available.
-- ============================================================
create table if not exists public.workspace_submission_answers (
  id                  uuid        primary key default gen_random_uuid(),
  submission_id       uuid        not null references public.workspace_submissions(id) on delete cascade,
  question_id         uuid        not null references public.workspace_template_questions(id),

  answer_text         text,
  answer_number       numeric,
  answer_boolean      boolean,
  answer_date         date,
  answer_json         jsonb,
  attachment_ids      uuid[],

  audit_result        text        check (audit_result is null
                                    or audit_result in ('pass','fail','na')),
  audit_was_critical  boolean,

  captured_at         timestamptz,
  geo_lat             numeric(9,6),
  geo_lng             numeric(9,6),

  created_at          timestamptz not null default now(),
  unique (submission_id, question_id)
);

create index if not exists workspace_submission_answers_question_idx
  on public.workspace_submission_answers (question_id, audit_result)
  where audit_result is not null;
create index if not exists workspace_submission_answers_fail_idx
  on public.workspace_submission_answers (question_id, submission_id)
  where audit_result = 'fail';

-- ============================================================
-- TABLE: workspace_submission_signoffs
--
-- One row per (submission, approval_step). Created at submit time
-- by snapshotting each approval_step from the template_version
-- onto the submission. candidate_user_ids holds the resolved list
-- at that moment so personnel changes don't disrupt the chain.
--
-- Status moves:
--   pending  → approved / rejected / skipped
-- "skipped" applies when a downstream rejection moves the
-- submission back to revision_requested and intermediate steps
-- are reset.
-- ============================================================
create table if not exists public.workspace_submission_signoffs (
  id                  uuid        primary key default gen_random_uuid(),
  submission_id       uuid        not null references public.workspace_submissions(id) on delete cascade,
  step_id             uuid        not null references public.workspace_template_approval_steps(id),
  step_number         int         not null check (step_number >= 1),
  status              text        not null default 'pending'
                                  check (status in ('pending','approved','rejected','skipped')),
  acted_by_id         uuid        references public.profiles(id) on delete set null,
  acted_at            timestamptz,
  notes               text,
  candidate_user_ids  uuid[]      not null default array[]::uuid[],
  created_at          timestamptz not null default now(),
  unique (submission_id, step_number)
);

create index if not exists workspace_submission_signoffs_submission_idx
  on public.workspace_submission_signoffs (submission_id, step_number);
create index if not exists workspace_submission_signoffs_pending_idx
  on public.workspace_submission_signoffs (submission_id) where status = 'pending';
-- GIN index on the candidate array for the "show me submissions where
-- I'm a candidate signer" query (RLS uses this; UI dashboards too):
create index if not exists workspace_submission_signoffs_candidates_idx
  on public.workspace_submission_signoffs using gin (candidate_user_ids);

-- ============================================================
-- TABLE: workspace_attachments
--
-- Generic file table. Any record (submission_answers, cap_proofs in
-- 0061, etc.) attaches via the attachment_ids array on the owning
-- row. Files live in the private `workspace-attachments` storage
-- bucket; backend serves them via signed URLs.
--
-- role labels the file's purpose for UI ('photo_evidence',
-- 'signature', 'document', 'cap_proof', etc.) — free text so we
-- can add new ones without migrating.
-- ============================================================
create table if not exists public.workspace_attachments (
  id                  uuid        primary key default gen_random_uuid(),
  workspace_id        uuid        not null references public.workspaces(id) on delete cascade,
  storage_path        text        not null,
  file_name           text        not null,
  file_size           int,
  mime_type           text,
  role                text,
  captured_at         timestamptz,
  geo_lat             numeric(9,6),
  geo_lng             numeric(9,6),
  uploaded_by_id      uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists workspace_attachments_workspace_idx
  on public.workspace_attachments (workspace_id, created_at desc);

-- ============================================================
-- TRIGGER: keep workspace_schedules.updated_at current.
-- ============================================================
drop trigger if exists workspace_schedules_set_updated_at_trg on public.workspace_schedules;
create trigger workspace_schedules_set_updated_at_trg
  before update on public.workspace_schedules
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- STORAGE BUCKET: workspace-attachments (PRIVATE)
--
-- Differs from wo2-ticket-photos (public) on purpose. Workspace
-- attachments are compliance artifacts — audit evidence, signatures,
-- CAP proofs. Backend serves via signed URLs only. Idempotent insert.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('workspace-attachments', 'workspace-attachments', false)
on conflict (id) do update set public = excluded.public;

-- ============================================================
-- EXTEND: workspace_activity_log.action CHECK
--
-- 0059 enumerated 14 actions; 0060 adds 16 more for the runtime
-- layer. We drop and recreate the constraint to extend it.
-- ============================================================
alter table public.workspace_activity_log
  drop constraint if exists workspace_activity_log_action_check;

alter table public.workspace_activity_log
  add constraint workspace_activity_log_action_check check (action in (
    -- workspace lifecycle
    'workspace.created','workspace.updated','workspace.archived','workspace.unarchived',
    -- membership
    'member.added','member.role_changed','member.removed',
    -- template lifecycle
    'template.created','template.updated','template.archived','template.unarchived',
    -- template version lifecycle
    'template_version.created','template_version.published','template_version.archived',
    'template_version.questions_changed','template_version.approval_steps_changed',
    -- schedules
    'schedule.created','schedule.updated','schedule.disabled','schedule.enabled',
    'schedule.spawned',
    -- assignments
    'assignment.created','assignment.cancelled','assignment.started','assignment.submitted',
    'assignment.marked_overdue',
    -- submissions
    'submission.created','submission.locked','submission.unlocked',
    'submission.revision_created',
    -- signoffs
    'signoff.approved','signoff.rejected','signoff.revision_requested','signoff.skipped',
    -- attachments
    'attachment.uploaded','attachment.deleted'
  ));

-- ============================================================
-- RLS — enable on all six new tables.
-- ============================================================
alter table public.workspace_schedules            enable row level security;
alter table public.workspace_assignments          enable row level security;
alter table public.workspace_submissions          enable row level security;
alter table public.workspace_submission_answers   enable row level security;
alter table public.workspace_submission_signoffs  enable row level security;
alter table public.workspace_attachments          enable row level security;

-- ── workspace_schedules ────────────────────────────────────
-- Visible iff parent workspace is visible.
create policy workspace_schedules_select on public.workspace_schedules
  for select using (
    exists (select 1 from public.workspaces w where w.id = workspace_schedules.workspace_id)
  );

-- ── workspace_assignments ──────────────────────────────────
-- Visible if any of:
--   1. You are the assignee (need to see your TODOs).
--   2. You can see the parent workspace.
create policy workspace_assignments_select on public.workspace_assignments
  for select using (
    assignee_id = auth.uid()
    or exists (select 1 from public.workspaces w where w.id = workspace_assignments.workspace_id)
  );

-- ── workspace_submissions ──────────────────────────────────
-- Visible if any of:
--   1. You submitted it.
--   2. You are the original assignment's assignee.
--   3. You are a signoff candidate (any step).
--   4. You can see the parent workspace.
create policy workspace_submissions_select on public.workspace_submissions
  for select using (
    submitted_by_id = auth.uid()
    or exists (
      select 1 from public.workspace_assignments a
      where a.id = workspace_submissions.assignment_id
        and a.assignee_id = auth.uid()
    )
    or exists (
      select 1 from public.workspace_submission_signoffs s
      where s.submission_id = workspace_submissions.id
        and auth.uid() = any (s.candidate_user_ids)
    )
    or exists (
      select 1 from public.workspace_assignments a
      join public.workspaces w on w.id = a.workspace_id
      where a.id = workspace_submissions.assignment_id
    )
  );

-- ── workspace_submission_answers ────────────────────────────────
-- Visible iff parent submission is visible (delegates).
create policy workspace_submission_answers_select on public.workspace_submission_answers
  for select using (
    exists (select 1 from public.workspace_submissions s where s.id = workspace_submission_answers.submission_id)
  );

-- ── workspace_submission_signoffs ────────────────────────────────
-- Visible if any of:
--   1. You're in candidate_user_ids (you need to see your queue).
--   2. You acted on it (acted_by_id = you).
--   3. The parent submission is visible.
create policy workspace_submission_signoffs_select on public.workspace_submission_signoffs
  for select using (
    auth.uid() = any (candidate_user_ids)
    or acted_by_id = auth.uid()
    or exists (select 1 from public.workspace_submissions s where s.id = workspace_submission_signoffs.submission_id)
  );

-- ── workspace_attachments ───────────────────────────────────
-- Visible iff parent workspace is visible. Object-level access
-- (i.e. who can GET the actual file from storage) is governed by
-- a storage policy added below.
create policy workspace_attachments_select on public.workspace_attachments
  for select using (
    exists (select 1 from public.workspaces w where w.id = workspace_attachments.workspace_id)
  );

-- ── Storage object policy for workspace-attachments bucket ─
-- Mirror the table policy: an authenticated user can read an object
-- iff there's a row in workspace_attachments referencing this path
-- AND its workspace is visible to them. Insert is service-role only
-- (handled by the backend); no INSERT policy = blocked from anon.
drop policy if exists workspace_attachments_storage_select on storage.objects;
create policy workspace_attachments_storage_select on storage.objects
  for select
  using (
    bucket_id = 'workspace-attachments'
    and exists (
      select 1 from public.workspace_attachments a
      where a.storage_path = name
    )
  );

-- ============================================================
-- PostgREST schema reload.
-- ============================================================
notify pgrst, 'reload schema';
