-- supabase/migrations/0121_walkthrough_assign_leaders.sql
--
-- Lets any leader (DO+) assign a walkthrough to the people below them —
-- DOs and SDOs, not just store GMs — and lets the store be left for the
-- assignee to choose when they run it (self-pick).
--
-- Changes:
--   * walkthrough_assignments.store_id becomes nullable (self-pick store).
--   * read policy: the creator (assigned_by) can always see what they
--     assigned, even before it has a store.
--   * write_leader policy: a DO+ can create a store-less assignment as
--     long as the assignee is someone they manage (manageable_users) — in
--     addition to the existing store-scoped path (unchanged for GMs).
--   * the assignee stamps the store at run time via the existing
--     walkthrough_assignments_update_assignee policy (assignee_id = uid),
--     so no new policy is needed for that.
--
-- No enum change — safe single block.

alter table public.walkthrough_assignments
  alter column store_id drop not null;

drop policy if exists walkthrough_assignments_read on public.walkthrough_assignments;
create policy walkthrough_assignments_read on public.walkthrough_assignments
  for select using (
    can_see_store(store_id)
    or assignee_id = auth.uid()
    or assigned_by = auth.uid()
  );

drop policy if exists walkthrough_assignments_write_leader on public.walkthrough_assignments;
create policy walkthrough_assignments_write_leader on public.walkthrough_assignments
  for all
  using (
    (role_level(walkthrough_caller_role()) >= role_level('do') or is_admin())
    and (
      can_see_store(store_id)
      or (store_id is null and assignee_id in (select id from manageable_users(auth.uid())))
    )
  )
  with check (
    (role_level(walkthrough_caller_role()) >= role_level('do') or is_admin())
    and (
      can_see_store(store_id)
      or (store_id is null and assignee_id in (select id from manageable_users(auth.uid())))
    )
  );

notify pgrst, 'reload schema';
