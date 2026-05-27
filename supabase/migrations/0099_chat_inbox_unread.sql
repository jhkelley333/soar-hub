-- Cheap per-thread unread + mention counts for the chat inbox.
--
-- The inbox previously fetched EVERY message in EVERY thread a user
-- belongs to (chat.js: select chat_messages where thread_id in (...),
-- no limit) just to count unread and detect @mentions in JS. That scan
-- grows without bound as history accumulates and is the main reason the
-- inbox feels sluggish.
--
-- This function does the counting in the database, returning only two
-- integers per thread. It rides the existing
-- idx_chat_messages_thread (thread_id, created_at) index via the
-- created_at > last_read_at join predicate, so it only touches the
-- unread tail of each thread, not its whole history.
--
-- Counting mirrors the old JS exactly: a message counts as unread when
-- it is newer than the member's last_read_at, is not a system message,
-- and was not sent by the caller. A mention additionally requires the
-- text to contain "@<caller-first-name>" (case-insensitive).

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
  where m.user_id = p_uid
  group by m.thread_id;
$$;

grant execute on function public.chat_inbox_unread(uuid, text) to authenticated, service_role;
