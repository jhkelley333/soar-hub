-- Rollback for 0084_chat_managed_sync.sql
drop function if exists public.chat_sync_managed_groups(uuid);
