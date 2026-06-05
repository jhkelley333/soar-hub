-- supabase/migrations/0122_walkthrough_public_walks.sql
--
-- Public / self-serve walkthroughs. A leader (DO+) can post an OPEN walk
-- that anyone in their scope (manageable_users) can pick up and do — no
-- specific assignee. When someone starts it, the server claims a personal
-- copy (a normal direct assignment) so the existing run/submit flow is
-- unchanged and many people can do the same public walk.
--
-- Builds on 0121 (store_id already nullable).
--
-- Changes:
--   * assignee_id becomes nullable (an open walk has no assignee yet).
--   * is_public flag + a CHECK that every row is either directed
--     (assignee_id not null) or public.
--   * source_assignment_id — set on a claimed copy, pointing at the open
--     walk it came from (lets us hide already-claimed walks).
--   * write_leader policy gains a public branch (a DO+ may post a public
--     walk attributed to themselves).
--   * read policy lets in-scope users see public walks. (Claims are made
--     server-side via the walkthrough function's service role.)
--
-- No enum change — safe single block.

alter table public.walkthrough_assignments
  alter column assignee_id drop not null;

alter table public.walkthrough_assignments
  add column if not exists is_public boolean not null default false,
  add column if not exists source_assignment_id uuid
    references public.walkthrough_assignments(id) on delete set null;

-- Every assignment is either directed at someone or a public/open walk.
alter table public.walkthrough_assignments
  drop constraint if exists walkthrough_assignments_directed_or_public;
alter table public.walkthrough_assignments
  add constraint walkthrough_assignments_directed_or_public
  check (assignee_id is not null or is_public);

create index if not exists walkthrough_assignments_public_idx
  on public.walkthrough_assignments(is_public) where is_public;

-- Read: existing paths + in-scope users can see public walks.
drop policy if exists walkthrough_assignments_read on public.walkthrough_assignments;
create policy walkthrough_assignments_read on public.walkthrough_assignments
  for select using (
    can_see_store(store_id)
    or assignee_id = auth.uid()
    or assigned_by = auth.uid()
    or (is_public and auth.uid() in (select id from manageable_users(assigned_by)))
  );

-- Write (leader): existing store / store-less paths + a public branch
-- (a DO+ posts a public walk attributed to themselves).
drop policy if exists walkthrough_assignments_write_leader on public.walkthrough_assignments;
create policy walkthrough_assignments_write_leader on public.walkthrough_assignments
  for all
  using (
    (role_level(walkthrough_caller_role()) >= role_level('do') or is_admin())
    and (
      can_see_store(store_id)
      or (store_id is null and assignee_id in (select id from manageable_users(auth.uid())))
      or (is_public and assigned_by = auth.uid())
    )
  )
  with check (
    (role_level(walkthrough_caller_role()) >= role_level('do') or is_admin())
    and (
      can_see_store(store_id)
      or (store_id is null and assignee_id in (select id from manageable_users(auth.uid())))
      or (is_public and assigned_by = auth.uid())
    )
  );

notify pgrst, 'reload schema';
