-- supabase/migrations/0058_rollback.sql
--
-- Reverses 0058_workspaces_foundation.sql. WARNING: drops all three
-- tables and the user_visible_scope_ids helper. Any workspace data
-- entered will be lost. Phases 0059-0061 reference these tables —
-- if those have been applied, roll them back first.

drop policy if exists workspace_activity_log_select on public.workspace_activity_log;
drop policy if exists workspace_members_select      on public.workspace_members;
drop policy if exists workspaces_select             on public.workspaces;

drop trigger if exists workspaces_set_updated_at_trg on public.workspaces;

drop table if exists public.workspace_activity_log;
drop table if exists public.workspace_members;
drop table if exists public.workspaces;

drop function if exists public.user_visible_scope_ids(uuid, text);

notify pgrst, 'reload schema';
