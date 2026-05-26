-- supabase/migrations/0096_ticket_needs_vendor_help.sql
--
-- Work Orders V2: vendor is now required to submit a ticket. The escape hatch
-- is "Need help finding a vendor" — the ticket still submits, but is flagged so
-- the store's DO can assign a vendor.
--
--   needs_vendor_help  set true when the store submits without choosing a vendor
--   vendor_help_at     when that flag was raised
--
-- The flag is cleared automatically when a vendor name is later assigned
-- (see updateTicket in facilities-v2.js).
--
-- Idempotent.

alter table public.tickets
  add column if not exists needs_vendor_help boolean     not null default false,
  add column if not exists vendor_help_at    timestamptz;
