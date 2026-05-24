-- Add a third chat thread type, 'requester', alongside 'internal' and
-- 'vendor'. Messages posted to the requester thread are emailed out to
-- the work order's requester (reply-to wo-<id>@inbound...), and their
-- email replies land back on this same thread via the resend-inbound
-- webhook. Keeps requester correspondence cleanly separated from the
-- private internal thread.

alter table public.ticket_messages
  drop constraint if exists ticket_messages_thread_type_check;

alter table public.ticket_messages
  add constraint ticket_messages_thread_type_check
  check (thread_type in ('internal', 'vendor', 'requester'));
