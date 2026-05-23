-- 0076_ticket_quotes.sql
--
-- Reframes a work order toward vendor approval:
--   • tickets.work_requested — the vendor's proposed scope of work
--     ("Replace ice maker, BOH Unit 2"). Distinct from issue_description,
--     which stays as the store's narrative (surfaced as "Justification").
--   • ticket_quotes — first-class quotes so a WO can carry more than one
--     for comparison. Each quote is a vendor + total + attached file.
--     The ticket's cost_estimate is kept in sync with the recommended
--     quote's total by the backend, so existing cost readers (list,
--     approval hero) keep working.
--
-- Like the other ticket_* tables (migration 0036) this is service-role
-- only — no RLS. All access goes through netlify/functions: facilities-v2.js
-- (internal) and vendor-portal.js (vendor self-submit, Phase 2).
--
-- Idempotent: ADD COLUMN / CREATE TABLE IF NOT EXISTS.

alter table public.tickets
  add column if not exists work_requested text;

create table if not exists ticket_quotes (
  id                    uuid primary key default gen_random_uuid(),
  ticket_id             uuid not null references tickets(id) on delete cascade,
  vendor_name           text not null default '',
  amount_cents          integer not null default 0,
  file_url              text,
  file_name             text,
  note                  text,
  is_recommended        boolean not null default false,
  -- 'internal' = added by a SOAR user; 'vendor' = self-submitted via the
  -- public vendor portal (Phase 2).
  source                text not null default 'internal'
                          check (source in ('internal', 'vendor')),
  submitted_by_user_id  uuid,
  submitted_by_name     text,
  created_at            timestamptz default now()
);

create index if not exists idx_ticket_quotes_ticket on ticket_quotes (ticket_id);
