-- Rollback for 0085_chat_attachments.sql
drop table if exists public.chat_attachments;
drop policy if exists chat_attach_storage_read on storage.objects;
drop policy if exists chat_attach_storage_insert on storage.objects;
drop policy if exists chat_attach_storage_delete on storage.objects;
delete from storage.buckets where id = 'chat-attachments';
