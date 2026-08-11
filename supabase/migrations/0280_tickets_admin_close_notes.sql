-- 0280_tickets_admin_close_notes.sql
-- Add the missing tickets.admin_close_notes column so cancel/close transitions
-- can persist their free-text sub-reason (e.g. duplicate WO number).

-- Migration 0042 added admin_close_reason / store_close_reason / resolution_category
-- but never added admin_close_notes, even though the ticket state machine writes
-- it on every cancel/close side effect — so cancelling a ticket failed with
-- "Could not find the 'admin_close_notes' column of 'tickets' in the schema cache".
alter table tickets
  add column if not exists admin_close_notes text;

-- Refresh PostgREST's schema cache so the new column is visible immediately.
notify pgrst, 'reload schema';
