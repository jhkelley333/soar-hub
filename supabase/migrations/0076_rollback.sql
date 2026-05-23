-- Rollback for 0076_ticket_quotes.sql
drop table if exists ticket_quotes;
alter table public.tickets
  drop column if exists work_requested;
