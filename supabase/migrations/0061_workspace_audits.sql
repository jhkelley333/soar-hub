-- supabase/migrations/0061_workspace_audits.sql
--
-- Phase 4 of 4 (final) for the Workspace feature. Adds the audit-
-- specific layer: corrective action plans, proof submissions on
-- those plans, repeat-finding detection, and automation rules.
--
-- After this phase, the schema is complete. Backend functions +
-- UI can be built against it.
--
-- Depends on 0058 (workspaces, activity_log), 0059 (templates +
-- questions), 0060 (submissions + answers + attachments).
--
-- Tables:
--   workspace_corrective_action_plans  one CAP per failed audit answer
--   workspace_cap_proofs               proof submissions on a CAP
--   workspace_repeat_findings          aggregations of recurring
--                                      same-question failures
--   workspace_automations              trigger → condition → action rules
--
-- CAP lifecycle:
--   open → in_progress → proof_submitted → verified → closed
--                                       ↓
--                                    reopened
--
-- Repeat findings: one row per (store, question). occurrences JSONB
-- holds the failure history. Detection runs at submission time
-- (app-side): when an audit answer fails for a question, the app
-- upserts the repeat_finding row. Acknowledged repeats stop
-- triggering automations until the next failure resets the
-- acknowledgment.
--
-- Activity-log vocabulary completed with 16 more actions for cap.*,
-- cap_proof.*, repeat_finding.*, automation.*.
--
-- Rollback: see 0061_rollback.sql.

-- ============================================================
-- TABLE: workspace_corrective_action_plans
--
-- Auto-generated at submission time when an audit answer fails on
-- a question with requires_cap_on_fail = true. Distinct lifecycle
-- from the parent submission — a CAP can stay open long after the
-- audit it came from is approved.
--
-- assignee_id: who must remediate. Defaults from the question's
-- cap_assignee_rule DSL but is captured concretely here so it
-- survives rule changes.
--
-- verifier_id: who confirms the proof. Optional; if null, the
-- assignee's manager or the workspace owner verifies (app rule).
-- Captured concretely here for the same reason.
--
-- reopened_count tracks how many times this same CAP has been
-- reopened by a verifier (proof inadequate) — useful for both
-- escalation logic and trend dashboards.
-- ============================================================
create table if not exists public.workspace_corrective_action_plans (
  id                     uuid        primary key default gen_random_uuid(),
  workspace_id           uuid        not null references public.workspaces(id) on delete cascade,
  submission_id          uuid        not null references public.workspace_submissions(id),
  answer_id              uuid        not null references public.workspace_submission_answers(id),
  question_id            uuid        not null references public.workspace_template_questions(id),
  store_id               uuid        references public.stores(id),

  assignee_id            uuid        not null references public.profiles(id) on delete restrict,
  verifier_id            uuid        references public.profiles(id) on delete set null,

  due_at                 timestamptz,
  status                 text        not null default 'open'
                                     check (status in (
                                       'open','in_progress','proof_submitted',
                                       'verified','closed','reopened'
                                     )),

  template_instructions  text,         -- copied from the question at CAP-creation
  failure_notes          text,         -- per-failure note from the auditor

  verified_at            timestamptz,
  verified_by_id         uuid        references public.profiles(id) on delete set null,

  reopened_count         int         not null default 0 check (reopened_count >= 0),
  last_reopened_at       timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists workspace_caps_assignee_idx
  on public.workspace_corrective_action_plans (assignee_id, status);
create index if not exists workspace_caps_verifier_idx
  on public.workspace_corrective_action_plans (verifier_id, status)
  where verifier_id is not null;
create index if not exists workspace_caps_store_idx
  on public.workspace_corrective_action_plans (store_id, status)
  where store_id is not null;
create index if not exists workspace_caps_due_idx
  on public.workspace_corrective_action_plans (due_at)
  where status in ('open','in_progress','proof_submitted');
create index if not exists workspace_caps_workspace_idx
  on public.workspace_corrective_action_plans (workspace_id, status);
create index if not exists workspace_caps_question_idx
  on public.workspace_corrective_action_plans (question_id);

-- ============================================================
-- TABLE: workspace_cap_proofs
--
-- Proof submissions on a CAP. A CAP can have multiple proof rows
-- if the verifier rejects the first attempt (each rejection bumps
-- the parent CAP's reopened_count).
--
-- verified_status:
--   null      — submitted, verifier hasn't reviewed yet
--   accepted  — proof closes the CAP
--   rejected  — proof is inadequate; CAP reopens
-- ============================================================
create table if not exists public.workspace_cap_proofs (
  id              uuid        primary key default gen_random_uuid(),
  cap_id          uuid        not null references public.workspace_corrective_action_plans(id) on delete cascade,
  submitted_by_id uuid        references public.profiles(id) on delete set null,
  submitted_at    timestamptz not null default now(),
  notes           text,
  attachment_ids  uuid[],
  verified_status text        check (verified_status is null
                                or verified_status in ('accepted','rejected')),
  verified_at     timestamptz,
  verified_by_id  uuid        references public.profiles(id) on delete set null,
  verifier_notes  text
);

create index if not exists workspace_cap_proofs_cap_idx
  on public.workspace_cap_proofs (cap_id, submitted_at desc);
create index if not exists workspace_cap_proofs_pending_idx
  on public.workspace_cap_proofs (cap_id) where verified_status is null;

-- ============================================================
-- TABLE: workspace_repeat_findings
--
-- Aggregation of recurring same-question failures at the same
-- store. One row per (store, question); the occurrences JSONB
-- accumulates the failure history. Created/updated by app code
-- at submission time (not via trigger — we want explicit control
-- over the window + reasoning).
--
-- Acknowledged repeats stop alerting until the next failure
-- resets acknowledged_at to null (app responsibility).
--
-- occurrences schema:
--   [
--     { "submission_id": "<uuid>", "answer_id": "<uuid>",
--       "failed_at": "<iso8601>", "was_critical": true|false }
--   ]
-- Order: ascending by failed_at (oldest first).
-- ============================================================
create table if not exists public.workspace_repeat_findings (
  id                    uuid        primary key default gen_random_uuid(),
  workspace_id          uuid        not null references public.workspaces(id) on delete cascade,
  store_id              uuid        not null references public.stores(id),
  question_id           uuid        not null references public.workspace_template_questions(id),

  occurrences           jsonb       not null,
  first_occurred_at     timestamptz not null,
  last_occurred_at      timestamptz not null,
  occurrence_count      int         not null default 2 check (occurrence_count >= 2),

  -- Acknowledgment fields. When set, automations skip this finding
  -- until the next failure (app resets these to null on new failure).
  acknowledged_at       timestamptz,
  acknowledged_by_id    uuid        references public.profiles(id) on delete set null,
  acknowledged_note     text,

  created_at            timestamptz not null default now(),
  unique (store_id, question_id)
);

create index if not exists workspace_repeat_findings_workspace_idx
  on public.workspace_repeat_findings (workspace_id, last_occurred_at desc);
create index if not exists workspace_repeat_findings_unacknowledged_idx
  on public.workspace_repeat_findings (workspace_id, occurrence_count desc)
  where acknowledged_at is null;
create index if not exists workspace_repeat_findings_store_idx
  on public.workspace_repeat_findings (store_id, last_occurred_at desc);

-- ============================================================
-- TABLE: workspace_automations
--
-- Trigger → condition → action rules. Evaluated by a worker
-- (Netlify scheduled function for cron-style triggers; the
-- submission/CAP-creation backend code for event-driven triggers).
--
-- trigger JSON DSL examples:
--   { "kind": "on_submit", "template_id": "<uuid>" }
--   { "kind": "on_score_below", "template_id": "<uuid>", "threshold": 80 }
--   { "kind": "on_cap_overdue" }
--   { "kind": "on_cap_reopened", "min_reopens": 2 }
--   { "kind": "on_repeat_finding", "min_occurrences": 3 }
--   { "kind": "scheduled", "cron": "0 9 * * 1" }   (Monday 9am)
--
-- condition JSON DSL (optional filter — null = always pass):
--   { "all": [ {...}, {...} ] }   AND
--   { "any": [ {...}, {...} ] }   OR
--   { "store_in": ["<uuid>", ...] }
--   { "tier_at_least": "rvp" }
--
-- action JSON DSL examples:
--   { "kind": "send_email", "to_role": "rvp", "template": "audit_failed" }
--   { "kind": "create_assignment", "template_id": "<uuid>",
--     "assignee_rule": { "kind": "role_relative", "role": "do",
--                        "anchor": "submission_store" } }
--   { "kind": "notify_in_app", "to_role": "do" }
--   { "kind": "create_cap", "instructions": "..." }
-- ============================================================
create table if not exists public.workspace_automations (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references public.workspaces(id) on delete cascade,
  name            text        not null,
  trigger         jsonb       not null,
  condition       jsonb,
  action          jsonb       not null,
  is_active       boolean     not null default true,
  last_fired_at   timestamptz,
  fire_count      int         not null default 0 check (fire_count >= 0),
  created_by_id   uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists workspace_automations_workspace_idx
  on public.workspace_automations (workspace_id, is_active);
-- GIN index on trigger so the worker can efficiently filter rules
-- by trigger.kind:
create index if not exists workspace_automations_trigger_idx
  on public.workspace_automations using gin (trigger);

-- ============================================================
-- TRIGGERS: updated_at on CAPs + automations.
-- ============================================================
drop trigger if exists workspace_caps_set_updated_at_trg on public.workspace_corrective_action_plans;
create trigger workspace_caps_set_updated_at_trg
  before update on public.workspace_corrective_action_plans
  for each row
  execute function public.set_updated_at();

drop trigger if exists workspace_automations_set_updated_at_trg on public.workspace_automations;
create trigger workspace_automations_set_updated_at_trg
  before update on public.workspace_automations
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- EXTEND: workspace_activity_log.action CHECK (final)
--
-- 0060 enumerated 35 actions. 0061 adds 16 more to cover the
-- audit-specific domain (CAPs, CAP proofs, repeat findings,
-- automations). Total: 51.
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

-- ============================================================
-- RLS — enable on all four new tables.
-- ============================================================
alter table public.workspace_corrective_action_plans enable row level security;
alter table public.workspace_cap_proofs              enable row level security;
alter table public.workspace_repeat_findings         enable row level security;
alter table public.workspace_automations             enable row level security;

-- ── workspace_corrective_action_plans ──────────────────────────
-- Visible if any of:
--   1. You are the assignee (must see your CAPs).
--   2. You are the verifier (must see what you're verifying).
--   3. You can see the parent workspace.
create policy workspace_caps_select on public.workspace_corrective_action_plans
  for select using (
    assignee_id = auth.uid()
    or verifier_id = auth.uid()
    or exists (select 1 from public.workspaces w where w.id = workspace_corrective_action_plans.workspace_id)
  );

-- ── workspace_cap_proofs ───────────────────────────────────
-- Visible iff parent CAP is visible (delegates).
create policy workspace_cap_proofs_select on public.workspace_cap_proofs
  for select using (
    exists (select 1 from public.workspace_corrective_action_plans c
            where c.id = workspace_cap_proofs.cap_id)
  );

-- ── workspace_repeat_findings ────────────────────────────────
-- Aggregations are workspace-scoped reporting data; visible to
-- anyone who can see the workspace.
create policy workspace_repeat_findings_select on public.workspace_repeat_findings
  for select using (
    exists (select 1 from public.workspaces w where w.id = workspace_repeat_findings.workspace_id)
  );

-- ── workspace_automations ──────────────────────────────────
-- Admin-config; visible iff workspace visible.
create policy workspace_automations_select on public.workspace_automations
  for select using (
    exists (select 1 from public.workspaces w where w.id = workspace_automations.workspace_id)
  );

-- ============================================================
-- PostgREST schema reload.
-- ============================================================
notify pgrst, 'reload schema';
