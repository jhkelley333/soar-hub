-- Rollback for 0087_chat_group_permissions.sql
alter table public.chat_threads
  drop column if exists perm_send,
  drop column if exists perm_add,
  drop column if exists perm_edit;
