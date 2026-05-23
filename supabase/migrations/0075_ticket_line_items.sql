-- 0075_ticket_line_items.sql
--
-- Cost line-item breakdown for work orders (the "Line Items" table in
-- the WO Approval design). Stored as a jsonb array on the ticket rather
-- than a child table — the breakdown is always read and written with
-- its parent ticket, never queried independently, so a column keeps the
-- read path to a single row with no join.
--
-- Shape of each element (enforced by the app, not the DB):
--   { "label": "Hoshizaki KM-650MAJ", "qty": 1, "amount_cents": 320000 }
-- amount_cents is the LINE TOTAL in cents (qty already factored in by
-- the client). The ticket's cost_estimate is kept in sync by the
-- backend as sum(amount_cents)/100 whenever line_items are written, so
-- existing cost readers keep working unchanged.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Default '[]' so every existing
-- ticket reads back an empty breakdown (renders as "no line items").

alter table public.tickets
  add column if not exists line_items jsonb not null default '[]'::jsonb;
