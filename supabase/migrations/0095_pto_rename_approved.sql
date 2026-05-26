-- supabase/migrations/0095_pto_rename_approved.sql
--
-- Relabel the PTO SDO/RVP-approval status for clarity, to parallel "DO Approved":
--   pto_requests:  "Approved" -> "SDO/RVP Approved"
--
-- Training keeps its plain "Approved" (it has only one approval tier).
-- PAF Submitted remains the terminal "close out".
-- Plain-text status, so this is just a data rename. Idempotent.

update pto_requests set status = 'SDO/RVP Approved' where status = 'Approved';
