-- supabase/migrations/0094_pto_tracking_sheet.sql
--
-- Insert an SDO/RVP "On Tracking Sheet" step into the PTO flow, before the DO
-- submits the vacation PAF:
--
--   pto_requests:
--     Approved          --(SDO/RVP logs it on the tracking sheet)--> On Tracking Sheet
--     On Tracking Sheet --(DO confirms the vacation PAF was submitted)--> PAF Submitted
--
-- Only adds the tracking columns; the status values are plain text, so no data
-- backfill is needed. Any in-flight "Approved" PTO now routes to the SDO/RVP
-- tracking-sheet step first.
--
-- Idempotent.

alter table pto_requests
  add column if not exists tracked_at    timestamptz,
  add column if not exists tracked_by_id uuid references profiles(id) on delete set null;
