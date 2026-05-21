-- supabase/migrations/0058_workspaces_foundation.sql
--
-- Phase 1 of 4 for the Workspace feature (forms + audits + CAPs +
-- automations). Establishes the top-level container, membership,
-- and canonical activity log. No user-visible surface yet — this
-- migration creates infrastructure that 0059-0061 build on.
--
-- Security posture: defense-in-depth hybrid.
--   - RLS enabled on every Workspace table.
--   - SELECT policies admit admins/payroll + workspace members +
--     scope-based viewers (when the workspace is anchored to a
--     region/area/district/store).
--   - Writes go through netlify functions with service-role key +
--     a capability map in _lib/workspace_permissions.js (mirrors
--     the existing _lib/permissions.js pattern from WO2).
--
-- Audit convention: one canonical workspace_activity_log table
-- using polymorphic target_kind + target_id (same shape as
-- org_changes). Departs from the 7-flavor variance in older
-- modules on purpose — new feature gets a clean baseline. Older
-- modules are not retrofitted.
--
-- Rollback: see 0058_rollback.sql.

-- ============================================================
-- HELPER: user_visible_scope_ids(uid, kind)
--
-- Single-entry dispatcher over user_visible_regions / _areas /
-- _districts / _stores. Returns setof uuid for the requested kind.
-- Used by RLS policies that evaluate workspace.scope_anchor_*
-- coverage. Returns empty set for unknown kinds rather than erroring
-- (defensive — RLS policy with empty set just denies access).
-- ============================================================
create or replace function public.user_visible_scope_ids(uid uuid, kind text)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if kind = 'region' then
    return query select * from user_visible_regions(uid);
  elsif kind = 'area' then
    return query select * from user_visible_areas(uid);
  elsif kind = 'district' then
    return query select * from user_visible_districts(uid);
  elsif kind = 'store' then
    return query select * from user_visible_stores(uid);
  end if;
end;
$$;

-- ============================================================
-- TABLE: workspaces
--
-- Top-level container. Owns templates + assignments + members.
-- Two access dimensions:
--   1. visibility — 'private' / 'scoped' / 'organization'
--   2. scope_anchor_* — optional binding to a region/area/district/store.
--      When set + visibility='scoped', anyone whose org-chart scope
--      covers the anchor gets read access (no explicit member row
--      required). When null, only workspace_members rows grant access.
-- ============================================================
create table if not exists public.workspaces (
  id                  uuid        primary key default gen_random_uuid(),
  name                text        not null,
  description         text,
  visibility          text        not null default 'scoped'
                                  check (visibility in ('private', 'scoped', 'organization')),

  -- Optional anchor to an org-chart node. NULL = workspace is not
  -- tied to a specific scope (private to its explicit members).
  scope_anchor_kind   text        check (scope_anchor_kind is null
                                    or scope_anchor_kind in ('region', 'area', 'district', 'store')),
  scope_anchor_id     uuid,
  -- Both must be set or both null
  constraint workspaces_anchor_paired check (
    (scope_anchor_kind is null and scope_anchor_id is null)
    or (scope_anchor_kind is not null and scope_anchor_id is not null)
  ),

  is_archived         boolean     not null default false,
  created_by_id       uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists workspaces_active_idx
  on public.workspaces (is_archived) where is_archived = false;
create index if not exists workspaces_anchor_idx
  on public.workspaces (scope_anchor_kind, scope_anchor_id)
  where scope_anchor_id is not null;

-- ============================================================
-- TABLE: workspace_members
--
-- Explicit membership grants. workspace_role is orthogonal to the
-- caller's org-role — a GM (store tier) can be a workspace 'editor'
-- on a workspace owned by an admin, without elevating their org
-- role. Roles:
--   owner     — full control incl. archive and member management
--   editor    — create/edit templates, schedules, automations
--   submitter — fill assignments only
--   viewer    — read-only
-- ============================================================
create table if not exists public.workspace_members (
  workspace_id    uuid        not null references public.workspaces(id) on delete cascade,
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  workspace_role  text        not null
                              check (workspace_role in ('owner', 'editor', 'submitter', 'viewer')),
  added_by_id     uuid        references public.profiles(id) on delete set null,
  added_at        timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id);

-- ============================================================
-- TABLE: workspace_activity_log
--
-- Canonical audit trail for the whole Workspace feature. Replaces
-- the per-table audit pattern (paf_audit_log, team_changes, etc.)
-- with one polymorphic table for the Workspace domain. Older
-- modules keep their own audit tables — no retrofit.
--
-- Conventions (locked):
--   - actor_id FK SET NULL + actor_email + actor_role snapshots
--     so we never lose identity when a profile is hard-deleted.
--   - target_kind + target_id polymorphic (same shape as org_changes).
--   - action: free text with CHECK to be added per-domain as we
--     enumerate them. Starting permissive; will tighten in 0059+.
--   - before_state / after_state as structured JSON pairs, plus
--     event_data for free-form context (e.g. score, fail reason).
--   - created_at (matches majority convention; org_changes/team_changes).
-- ============================================================
create table if not exists public.workspace_activity_log (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        references public.workspaces(id) on delete cascade,
  actor_id        uuid        references public.profiles(id) on delete set null,
  actor_email     text,
  actor_role      text,
  target_kind     text        not null
                              check (target_kind in (
                                'workspace', 'member', 'template', 'template_version',
                                'assignment', 'submission', 'signoff',
                                'cap', 'cap_proof', 'repeat_finding',
                                'automation', 'schedule'
                              )),
  target_id       uuid        not null,
  action          text        not null,
  event_data      jsonb,
  before_state    jsonb,
  after_state     jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists workspace_activity_log_workspace_idx
  on public.workspace_activity_log (workspace_id, created_at desc);
create index if not exists workspace_activity_log_target_idx
  on public.workspace_activity_log (target_kind, target_id, created_at desc);
create index if not exists workspace_activity_log_actor_idx
  on public.workspace_activity_log (actor_id, created_at desc);

-- ============================================================
-- TRIGGER: keep workspaces.updated_at current.
-- Reuses the existing public.set_updated_at() function from 0035.
-- ============================================================
drop trigger if exists workspaces_set_updated_at_trg on public.workspaces;
create trigger workspaces_set_updated_at_trg
  before update on public.workspaces
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- RLS — enable on all three tables.
-- ============================================================
alter table public.workspaces             enable row level security;
alter table public.workspace_members      enable row level security;
alter table public.workspace_activity_log enable row level security;

-- ── workspaces ───────────────────────────────────────────────
-- A user can SELECT a workspace if any of:
--   1. They are admin or payroll (full read across the org).
--   2. They have a workspace_members row.
--   3. Visibility = 'organization' AND they're an active profile.
--   4. Visibility = 'scoped' AND workspace has a scope_anchor_*
--      AND their org-chart scope covers that anchor.
-- Writes blocked at the policy layer — backend uses service-role.
create policy workspaces_select on public.workspaces
  for select
  using (
    is_admin()
    or is_payroll()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id
        and m.user_id = auth.uid()
    )
    or (
      visibility = 'organization'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_active = true
      )
    )
    or (
      visibility = 'scoped'
      and scope_anchor_id is not null
      and scope_anchor_id in (
        select public.user_visible_scope_ids(auth.uid(), scope_anchor_kind)
      )
    )
  );

-- ── workspace_members ────────────────────────────────────────
-- A user can SELECT a membership row if:
--   1. It's their own row, OR
--   2. They can see the parent workspace (delegates to workspaces RLS).
-- Admin/payroll covered transitively via workspaces policy.
create policy workspace_members_select on public.workspace_members
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_members.workspace_id
    )
  );

-- ── workspace_activity_log ───────────────────────────────────
-- Admin/payroll always. Workspace owners always (for their workspace).
-- Other members do NOT see the activity log by default — operational
-- transparency is by-workspace-role. App can surface filtered slices
-- via the backend if needed.
create policy workspace_activity_log_select on public.workspace_activity_log
  for select
  using (
    is_admin()
    or is_payroll()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspace_activity_log.workspace_id
        and m.user_id = auth.uid()
        and m.workspace_role = 'owner'
    )
  );

-- ============================================================
-- PostgREST schema reload — picks up new tables + policies without
-- requiring a Supabase restart.
-- ============================================================
notify pgrst, 'reload schema';
