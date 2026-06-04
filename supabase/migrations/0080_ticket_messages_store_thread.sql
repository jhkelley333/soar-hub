-- Add a fourth chat thread type, 'store', alongside 'internal', 'vendor',
-- and 'requester'. Messages posted to the store thread are emailed to the
-- store's inbox (stores.email for the ticket's store), optionally CC'ing
-- the store's DO, with reply-to wo-<id>--store@inbound... so email replies
-- land back on this same thread via the resend-inbound webhook. Keeps
-- store correspondence separate from the requester thread.

alter table public.ticket_messages
  drop constraint if exists ticket_messages_thread_type_check;

alter table public.ticket_messages
  add constraint ticket_messages_thread_type_check
  check (thread_type in ('internal', 'vendor', 'requester', 'store'));
