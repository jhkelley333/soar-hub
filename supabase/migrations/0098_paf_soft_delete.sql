-- supabase/migrations/0098_paf_soft_delete.sql
--
-- Admin soft-delete for PAFs. The `archived` / `archived_at` columns already
-- exist (0016) and every list query filters `archived = false`, so a deleted
-- PAF disappears from all queues. These two columns capture *who* deleted it
-- and *why*; the deletion itself is also written to paf_audit_log as a
-- "delete" event ("Deleted by System Admin" + reason in the UI).
--
-- Idempotent.

alter table paf_submissions
  add column if not exists archived_reason text,
  add column if not exists archived_by_id  uuid references profiles(id) on delete set null;
