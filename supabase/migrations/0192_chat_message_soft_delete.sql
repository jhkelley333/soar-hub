-- 0192_chat_message_soft_delete.sql
-- Soft-delete for chat messages: a deleted_at/deleted_by stamp keeps the row
-- (audit + thread continuity) while the UI shows a "message deleted" tombstone.
-- The inbox unread/mention RPC is updated to ignore deleted messages, so
-- deleting a message also clears its unread + "needs you" notification.

alter table public.chat_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

-- Recreate the unread/mention counter to skip soft-deleted messages. Same
-- logic as 0099 plus `and msg.deleted_at is null`, so a deleted message stops
-- counting toward the unread + "needs you" badge the moment it's removed.
create or replace function public.chat_inbox_unread(p_uid uuid, p_first text)
returns table (thread_id uuid, unread integer, mentioned integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.thread_id,
    count(*) filter (
      where not msg.system
        and msg.from_user_id is distinct from p_uid
    )::int as unread,
    count(*) filter (
      where not msg.system
        and msg.from_user_id is distinct from p_uid
        and p_first <> ''
        and position('@' || lower(p_first) in lower(msg.text)) > 0
    )::int as mentioned
  from public.chat_thread_members m
  join public.chat_messages msg
    on msg.thread_id = m.thread_id
   and msg.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)
   and msg.deleted_at is null
  where m.user_id = p_uid
  group by m.thread_id;
$$;

grant execute on function public.chat_inbox_unread(uuid, text) to authenticated, service_role;
