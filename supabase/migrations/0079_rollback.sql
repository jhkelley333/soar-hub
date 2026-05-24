-- Revert to the two-thread constraint. NOTE: this fails if any
-- 'requester' rows still exist — re-thread or delete them first, e.g.
--   update public.ticket_messages set thread_type = 'internal'
--     where thread_type = 'requester';

alter table public.ticket_messages
  drop constraint if exists ticket_messages_thread_type_check;

alter table public.ticket_messages
  add constraint ticket_messages_thread_type_check
  check (thread_type in ('internal', 'vendor'));
