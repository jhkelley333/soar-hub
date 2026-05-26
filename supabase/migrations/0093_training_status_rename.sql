-- supabase/migrations/0093_training_status_rename.sql
--
-- Rename training tracking statuses to plainer labels:
--   "Entered"    -> "On Weekly Sheet"  (SDO/RVP logged it; labor report reflects it)
--   "Closed Out" -> "Completed"        (DO finished the closeout form)
--
-- PTO "PAF Submitted" is intentionally left unchanged.
-- Idempotent: only touches rows still on the old labels.

update training_credit_requests set status = 'On Weekly Sheet' where status = 'Entered';
update training_credit_requests set status = 'Completed'       where status = 'Closed Out';
