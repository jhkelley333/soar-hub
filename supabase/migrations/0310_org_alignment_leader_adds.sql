-- 0310_org_alignment_leader_adds.sql
-- Org Alignment: stage a NEW leader (not yet in the hub) to go live with the
-- alignment. On apply, the person is invited by email (Supabase auth invite,
-- same path as Team → add user), their profile role is set, and a user_scopes
-- row assigns them to the destination area/district (existing, or one created
-- in this same alignment). Rollback deletes the invited account, which cascades
-- their profile + scope. Admin-only; RLS on, service-role functions gate writes.

create table if not exists public.org_alignment_leader_adds (
  id              uuid primary key default gen_random_uuid(),
  alignment_id    uuid not null references public.org_alignments(id) on delete cascade,
  full_name       text,
  email           text not null,
  role            text not null check (role in ('do','sdo')),
  scope_type      text not null check (scope_type in ('area','district')),
  to_scope_id     uuid,               -- existing destination area/district
  to_scope_ref    text,               -- OR a new-node ref created in this alignment
  created_user_id uuid,               -- the invited user's id, set on apply
  applied         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists org_alignment_leader_adds_aid_idx
  on public.org_alignment_leader_adds (alignment_id);

alter table public.org_alignment_leader_adds enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'org_alignment_leader_adds_admin_all') then
    create policy org_alignment_leader_adds_admin_all
      on public.org_alignment_leader_adds for all
      using (is_admin()) with check (is_admin());
  end if;
end$$;

notify pgrst, 'reload schema';
