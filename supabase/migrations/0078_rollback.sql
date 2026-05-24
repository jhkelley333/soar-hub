-- Rollback for 0078_ticket_needs_info.sql
alter table public.tickets
  drop column if exists awaiting_info,
  drop column if exists awaiting_info_at,
  drop column if exists info_request_note;
