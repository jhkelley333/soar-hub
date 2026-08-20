-- 0303_trait_playbook_chunked.sql
-- Phase 7A: make DO Playbook generation chunked, resumable, and progress-aware.
-- The old design ran the whole team through ONE Anthropic call; a large team
-- truncated the response, the JSON parse failed, and the entire run was lost.
-- Now coaching is generated per member-batch and committed as each lands, with
-- a run header carrying live progress + the team-level synthesis. Both are
-- caches keyed by the team-composition hash (same key as trait_playbook_cache,
-- 0294), so a trait/roster change starts a fresh run.

-- ── trait_playbook_runs ──────────────────────────────────────────────────────
-- One row per (leader, team_hash) generation run. Holds progress for the poller
-- and the team-level synthesis (overview / dynamics / actions). status:
--   running -> generating; done -> complete; error -> stopped with work saved
--             (member coaching already committed; a resume finishes the rest).
create table if not exists public.trait_playbook_runs (
  leader_id       uuid not null references public.profiles(id) on delete cascade,
  team_hash       text not null,
  region          text,                       -- scope covered ('' / null = all)
  status          text not null default 'running'
                    check (status in ('running','done','error')),
  total_members   int  not null default 0,    -- members this run intends to coach (capped)
  coached_members int  not null default 0,    -- committed so far
  team_count      int  not null default 0,    -- full team size (pre-cap)
  truncated       boolean not null default false,
  overview        text,
  dynamics        text,
  actions         jsonb not null default '[]'::jsonb,
  error           text,
  model           text,
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  generated_at    timestamptz,                -- set when status -> done
  primary key (leader_id, team_hash)
);

alter table public.trait_playbook_runs enable row level security;

-- Writes happen via the service-role function only. A leader may read their own
-- run (progress + synthesis) directly if we ever want a client-side read path.
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'trait_playbook_runs_owner_read') then
    create policy trait_playbook_runs_owner_read on public.trait_playbook_runs
      for select using (auth.uid() = leader_id);
  end if;
end$$;

-- ── trait_playbook_member_coaching ───────────────────────────────────────────
-- Per-member coaching, committed one batch at a time. This is the resume store:
-- a re-run skips any member already present for the same (leader, team_hash).
create table if not exists public.trait_playbook_member_coaching (
  leader_id    uuid not null references public.profiles(id) on delete cascade,
  team_hash    text not null,
  member_id    uuid not null,
  coaching     text not null,
  model        text,
  generated_at timestamptz not null default now(),
  primary key (leader_id, team_hash, member_id)
);

create index if not exists trait_playbook_member_coaching_lookup_idx
  on public.trait_playbook_member_coaching (leader_id, team_hash);

alter table public.trait_playbook_member_coaching enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'trait_playbook_member_coaching_owner_read') then
    create policy trait_playbook_member_coaching_owner_read on public.trait_playbook_member_coaching
      for select using (auth.uid() = leader_id);
  end if;
end$$;

notify pgrst, 'reload schema';
