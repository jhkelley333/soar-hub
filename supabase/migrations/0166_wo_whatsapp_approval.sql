-- 0166_wo_whatsapp_approval.sql
--
-- Structured flag for out-of-system (WhatsApp / Owner) approvals on quotes
-- above the top approval tier ($1,750 = RVP NTE). The backend already records
-- a "verbal approval (WhatsApp/Owner) recorded by X" note + approved_by/at;
-- this boolean makes it queryable and lets the UI show a clear WhatsApp badge.

alter table ticket_approvals
  add column if not exists approved_via_whatsapp boolean not null default false;

notify pgrst, 'reload schema';
