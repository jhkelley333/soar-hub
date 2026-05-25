-- Rollback for 0083_managed_groups.sql
drop function if exists public.chat_reconcile_managed_group(uuid, uuid);
drop function if exists public.chat_org_roster(scope_type, uuid, user_role);
drop table if exists public.chat_membership_log;
drop index if exists public.uq_chat_threads_managed_scope;
alter table public.chat_threads
  drop column if exists managed,
  drop column if exists description,
  drop column if exists org_scope_type,
  drop column if exists org_scope_id,
  drop column if exists target_role,
  drop column if exists archived_at;
