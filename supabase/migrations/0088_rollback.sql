-- Rollback for 0088_fix_workspaces_rls_recursion.sql
-- Restores the original (recursive) workspaces_select and drops the helper.
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select
  using (
    is_admin()
    or is_payroll()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id and m.user_id = auth.uid()
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
drop function if exists public.is_workspace_member(uuid, uuid);
