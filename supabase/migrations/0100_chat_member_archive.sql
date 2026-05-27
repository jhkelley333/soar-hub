-- Per-user chat archive (iMessage-style "remove from my inbox").
--
-- The existing chat_threads.archived_at is a GLOBAL, owner/admin-only
-- archive that hides a thread for everyone. This adds a PER-MEMBER
-- archived_at so any member can clear a conversation from their own inbox
-- without affecting anyone else. The inbox auto-resurfaces a thread when a
-- newer message arrives after the member archived it (handled in chat.js:
-- show when last_message_at > member.archived_at).

alter table public.chat_thread_members
  add column if not exists archived_at timestamptz;
