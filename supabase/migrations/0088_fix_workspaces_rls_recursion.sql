-- supabase/migrations/0088_fix_workspaces_rls_recursion.sql
--
-- Fixes 42P17 "infinite recursion detected in policy for relation
-- workspaces". The workspaces_select policy did EXISTS(workspace_members)
-- and workspace_members_select did EXISTS(workspaces) — a mutual cycle.
-- The Workspaces feature never tripped it (it reads via service-role), but
-- the workspace_attachments storage policy pulls workspaces RLS into every
-- signed-URL read on storage.objects, which broke attachment reads for
-- chat (and any other private bucket).
--
-- Fix: route the membership check through a SECURITY DEFINER helper that
-- bypasses workspace_members RLS, breaking the cycle. Access rules are
-- unchanged.

create or replace function public.is_workspace_member(p_workspace uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user
  );
$$;

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select
  using (
    is_admin()
    or is_payroll()
    or public.is_workspace_member(workspaces.id, auth.uid())
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
