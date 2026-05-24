-- Rollback the chat schema.
drop trigger if exists trg_chat_touch_thread on public.chat_messages;
drop function if exists public.chat_touch_thread();
drop function if exists public.chat_is_member(uuid, uuid);
drop table if exists public.chat_messages;
drop table if exists public.chat_thread_members;
drop table if exists public.chat_threads;
