-- supabase/migrations/0097_pto_close_out.sql
--
-- Adds a terminal "Closed" step to the PTO flow, after the DO submits the PAF:
--
--   pto_requests:
--     PAF Submitted --(DO confirms it's fully closed out)--> Closed
--
-- "Closed" is the true terminal state; "PAF Submitted" is now an intermediate
-- waiting-on-DO state. Only adds the tracking columns — status is plain text,
-- so no data backfill is needed.
--
-- Idempotent.

alter table pto_requests
  add column if not exists closed_at    timestamptz,
  add column if not exists closed_by_id uuid references profiles(id) on delete set null;
