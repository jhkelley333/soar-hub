-- Rollback for 0086_chat_group_identity.sql
drop policy if exists chat_avatars_read on storage.objects;
drop policy if exists chat_avatars_insert on storage.objects;
drop policy if exists chat_avatars_update on storage.objects;
delete from storage.buckets where id = 'chat-avatars';
alter table public.chat_threads drop column if exists avatar_url;
