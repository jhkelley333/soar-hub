-- 0309_org_alignment_leader_moves.sql
-- Org Alignment: stage DO/SDO reassignments that go live with the alignment.
--
-- Leadership lives in user_scopes (user_id, scope_type, scope_id): an SDO holds
-- an 'area' scope, a DO a 'district' scope. A leader move reassigns a person's
-- scope from one area/district to another (existing or one created in this same
-- alignment) on apply, snapshotting the prior scope so it can be rolled back.
-- from_scope_id null = a brand-new assignment (removed again on rollback).
-- Admin-only; RLS on, service-role functions are the gatekeeper.

create table if not exists public.org_alignment_leader_moves (
  id             uuid primary key default gen_random_uuid(),
  alignment_id   uuid not null references public.org_alignments(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  scope_type     text not null check (scope_type in ('area','district')),
  from_scope_id  uuid,               -- current scope being replaced; null = new assignment
  to_scope_id    uuid,               -- existing destination area/district
  to_scope_ref   text,               -- OR a new-node ref created in this same alignment
  prior_scope_id uuid,               -- snapshot on apply, for rollback
  applied        boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists org_alignment_leader_moves_aid_idx
  on public.org_alignment_leader_moves (alignment_id);

alter table public.org_alignment_leader_moves enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'org_alignment_leader_moves_admin_all') then
    create policy org_alignment_leader_moves_admin_all
      on public.org_alignment_leader_moves for all
      using (is_admin()) with check (is_admin());
  end if;
end$$;

notify pgrst, 'reload schema';
