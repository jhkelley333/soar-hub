-- Rollback for 0075_ticket_line_items.sql
alter table public.tickets
  drop column if exists line_items;
