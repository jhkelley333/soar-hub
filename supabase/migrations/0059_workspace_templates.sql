-- supabase/migrations/0059_workspace_templates.sql
--
-- Phase 2 of 4 for the Workspace feature. Adds the template
-- definition layer:
--
--   workspace_templates              header (form vs audit)
--   workspace_template_versions      immutable snapshots; new edits
--                                    bump the version number
--   workspace_template_questions     one row per question per version
--   workspace_template_approval_steps  the 0-N sign-off chain
--
-- Versioning rule: once a version is 'published', its questions and
-- approval-step rows are immutable. Editing creates a new draft
-- version. Assignments + submissions (added in 0060) reference a
-- specific version_id, so historical submissions stay bound to the
-- question set they were answered against.
--
-- Also tightens workspace_activity_log.action with a CHECK now that
-- we know the vocabulary for the workspace + template domains. We
-- can extend the CHECK in 0060/0061 as new actions enter.
--
-- Rollback: see 0059_rollback.sql.

-- ============================================================
-- TABLE: workspace_templates
--
-- Header / metadata. type discriminates form vs audit. The two
-- diverge primarily in per-question fields (handled in
-- workspace_template_questions) and in audit-only header fields:
--
--   audit_pass_threshold  — % score required to pass (0-100)
--   critical_fails_audit  — when true, any critical-question fail
--                           forces overall outcome = 'fail_critical'
--                           regardless of percent. Default true.
--
-- Both audit_* fields are null for type='form'. Enforced by CHECK.
-- ============================================================
create table if not exists public.workspace_templates (
  id                     uuid        primary key default gen_random_uuid(),
  workspace_id           uuid        not null references public.workspaces(id) on delete cascade,
  name                   text        not null,
  description            text,
  type                   text        not null check (type in ('form', 'audit')),

  audit_pass_threshold   numeric(5,2)
                         check (audit_pass_threshold is null
                           or (audit_pass_threshold >= 0 and audit_pass_threshold <= 100)),
  critical_fails_audit   boolean     not null default true,

  -- audit_* fields only meaningful when type='audit'
  constraint workspace_templates_audit_fields_match_type check (
    (type = 'audit')
    or (type = 'form' and audit_pass_threshold is null)
  ),

  is_archived            boolean     not null default false,
  created_by_id          uuid        references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists workspace_templates_workspace_idx
  on public.workspace_templates (workspace_id, is_archived);
create index if not exists workspace_templates_type_idx
  on public.workspace_templates (type) where is_archived = false;

-- ============================================================
-- TABLE: workspace_template_versions
--
-- Immutable snapshots. Each edit to a template creates a new draft
-- version. Publishing locks the version; subsequent edits start a
-- fresh draft. Assignments + submissions reference a specific
-- version_id (added in 0060) so historical submissions remain
-- bound to the exact question set they answered.
--
-- Lifecycle: draft → published → archived. Only one 'draft' may
-- exist per template at a time (enforced by partial unique index).
-- Only one 'published' is "current" — the highest version_number
-- with status='published' wins; older published versions become
-- effectively archived but stay readable for historical submissions.
-- ============================================================
create table if not exists public.workspace_template_versions (
  id              uuid        primary key default gen_random_uuid(),
  template_id     uuid        not null references public.workspace_templates(id) on delete cascade,
  version_number  int         not null check (version_number >= 1),
  status          text        not null default 'draft'
                              check (status in ('draft', 'published', 'archived')),
  published_at    timestamptz,
  created_by_id   uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (template_id, version_number)
);

-- At most one draft per template at a time.
create unique index if not exists workspace_template_versions_one_draft_idx
  on public.workspace_template_versions (template_id)
  where status = 'draft';

create index if not exists workspace_template_versions_template_idx
  on public.workspace_template_versions (template_id, version_number desc);
create index if not exists workspace_template_versions_published_idx
  on public.workspace_template_versions (template_id, published_at desc)
  where status = 'published';

-- ============================================================
-- TABLE: workspace_template_questions
--
-- One row per question per version. Relational (not JSON) so we can
-- index + query critical/weight/required flags directly. JSONB
-- field_config holds type-specific UI metadata that doesn't need to
-- be queryable (dropdown options, regex pattern, max counts, etc).
--
-- Audit-only columns (weight, is_critical, requires_cap_on_fail,
-- cap_assignee_rule) carry meaning only when the parent template
-- type = 'audit'. We don't enforce that here at the SQL level
-- because the question doesn't know its template's type without a
-- join — the app enforces; phase 0060+ workflows skip these columns
-- for form-type submissions.
--
-- conditional_logic JSON DSL (evaluated by app, not Postgres):
--   { "show_if": [{ "question_id": "<uuid>", "op": "eq", "value": "yes" }] }
--
-- cap_assignee_rule JSON DSL (same vocabulary as approval_steps.approver_rule):
--   { "kind": "role_relative", "role": "do", "anchor": "submission_store" }
--   { "kind": "fixed", "user_id": "<uuid>" }
--   { "kind": "submitter_choice" }
-- ============================================================
create table if not exists public.workspace_template_questions (
  id                    uuid        primary key default gen_random_uuid(),
  version_id            uuid        not null references public.workspace_template_versions(id) on delete cascade,

  section_label         text,         -- nullable; flat list with optional grouping label
  position              int         not null check (position >= 0),

  question_text         text        not null,
  field_type            text        not null check (field_type in (
                          'short_text', 'long_text', 'number', 'select_one', 'select_many',
                          'checkbox', 'date', 'photo', 'file', 'signature',
                          'pass_fail_na'   -- audit-only
                        )),
  is_required           boolean     not null default false,

  -- Audit fields (null for form-type templates):
  weight                numeric(8,2) check (weight is null or weight >= 0),
  is_critical           boolean     not null default false,
  requires_cap_on_fail  boolean     not null default false,
  cap_assignee_rule     jsonb,

  -- Type-specific UI + validation config:
  --   select_one/many: { "options": ["A","B"], "allow_other": true }
  --   photo:           { "geo_tag_required": true, "max_count": 3 }
  --   number:          { "min": 0, "max": 100, "decimals": 2 }
  --   short_text:      { "max_length": 200, "pattern": "<regex>" }
  field_config          jsonb,

  -- Conditional logic (app-evaluated DSL; null = always shown):
  conditional_logic     jsonb,

  created_at            timestamptz not null default now(),
  unique (version_id, position)
);

create index if not exists workspace_template_questions_version_idx
  on public.workspace_template_questions (version_id, position);
create index if not exists workspace_template_questions_critical_idx
  on public.workspace_template_questions (version_id) where is_critical = true;

-- ============================================================
-- TABLE: workspace_template_approval_steps
--
-- The 0-N sign-off chain per template version. A template with zero
-- approval_steps rows means submissions are auto-finalized on submit
-- with no review (signoff_status = 'approved' immediately).
--
-- approver_rule JSON DSL (resolved by app at submission time to a
-- concrete list of user IDs, snapshotted onto
-- workspace_submission_signoffs.candidate_user_ids in 0060):
--
--   { "kind": "role_relative", "role": "do", "anchor": "submission_store" }
--   { "kind": "role_any",      "role": "rvp" }                  (any user with role)
--   { "kind": "any_of_roles",  "roles": ["sdo","rvp"] }
--   { "kind": "fixed",         "user_id": "<uuid>" }
--
-- any_can_approve = true: any one resolved candidate may approve
-- the step (most common — "any DO covering the store").
-- any_can_approve = false: ALL resolved candidates must approve
-- (rare — used for joint signoffs).
-- ============================================================
create table if not exists public.workspace_template_approval_steps (
  id              uuid        primary key default gen_random_uuid(),
  version_id      uuid        not null references public.workspace_template_versions(id) on delete cascade,
  step_number     int         not null check (step_number >= 1),
  label           text        not null,
  approver_rule   jsonb       not null,
  any_can_approve boolean     not null default true,
  created_at      timestamptz not null default now(),
  unique (version_id, step_number)
);

create index if not exists workspace_template_approval_steps_version_idx
  on public.workspace_template_approval_steps (version_id, step_number);

-- ============================================================
-- TRIGGER: keep workspace_templates.updated_at current.
-- Reuses public.set_updated_at() from 0035.
-- ============================================================
drop trigger if exists workspace_templates_set_updated_at_trg on public.workspace_templates;
create trigger workspace_templates_set_updated_at_trg
  before update on public.workspace_templates
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- TIGHTEN: workspace_activity_log.action CHECK
--
-- 0058 left action as free text. Now that the workspace + template
-- domains are enumerated, lock the vocabulary. 0060/0061 will
-- extend this constraint as submission, CAP, and automation
-- actions enter.
-- ============================================================
alter table public.workspace_activity_log
  add constraint workspace_activity_log_action_check check (action in (
    -- workspace lifecycle
    'workspace.created',
    'workspace.updated',
    'workspace.archived',
    'workspace.unarchived',
    -- membership
    'member.added',
    'member.role_changed',
    'member.removed',
    -- template lifecycle
    'template.created',
    'template.updated',
    'template.archived',
    'template.unarchived',
    -- template version lifecycle
    'template_version.created',
    'template_version.published',
    'template_version.archived',
    'template_version.questions_changed',
    'template_version.approval_steps_changed'
  ));

-- ============================================================
-- RLS — enable on all four new tables.
-- ============================================================
alter table public.workspace_templates              enable row level security;
alter table public.workspace_template_versions      enable row level security;
alter table public.workspace_template_questions     enable row level security;
alter table public.workspace_template_approval_steps enable row level security;

-- ── workspace_templates ────────────────────────────────────
-- A user can SELECT a template if they can see its parent workspace
-- (delegates to workspaces RLS). Admin/payroll covered transitively.
create policy workspace_templates_select on public.workspace_templates
  for select using (
    exists (select 1 from public.workspaces w where w.id = workspace_templates.workspace_id)
  );

-- ── workspace_template_versions ────────────────────────────────
create policy workspace_template_versions_select on public.workspace_template_versions
  for select using (
    exists (select 1 from public.workspace_templates t where t.id = workspace_template_versions.template_id)
  );

-- ── workspace_template_questions ───────────────────────────────
create policy workspace_template_questions_select on public.workspace_template_questions
  for select using (
    exists (select 1 from public.workspace_template_versions v
            where v.id = workspace_template_questions.version_id)
  );

-- ── workspace_template_approval_steps ──────────────────────────
create policy workspace_template_approval_steps_select on public.workspace_template_approval_steps
  for select using (
    exists (select 1 from public.workspace_template_versions v
            where v.id = workspace_template_approval_steps.version_id)
  );

-- ============================================================
-- PostgREST schema reload.
-- ============================================================
notify pgrst, 'reload schema';
