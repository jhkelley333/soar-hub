-- 0078_ticket_needs_info.sql
--
-- "Request more info" support. When an approver asks the requester (or
-- vendor / SDO) a question before deciding, the ticket enters a
-- Needs-Info state that pauses the approval clock until they reply.
--
--   awaiting_info     — true while a question is outstanding
--   awaiting_info_at  — when it entered Needs-Info (for "paused since")
--   info_request_note — the latest question text (surfaced on the card
--                       and, for vendor-directed asks, the portal)
--
-- The reply itself rides back through the existing chat thread (synced
-- from the inbound Resend webhook in the follow-up PR), and decideApproval
-- / a fresh reply clears the flag.

alter table public.tickets
  add column if not exists awaiting_info     boolean     not null default false,
  add column if not exists awaiting_info_at  timestamptz,
  add column if not exists info_request_note text;
