-- supabase/migrations/0055_replacement_equipment.sql
--
-- Adds the "replace rather than repair" workflow to WO2:
--   * New ticket status value 'awaiting_equipment'. Lives between
--     the decision-to-replace and the install. Reached via the new
--     "Order Replacement" action on the ticket.
--   * Replacement detail columns on tickets so the team can record
--     what was ordered, from whom, at what cost, and the expected
--     install date. ordered_at is a timestamptz audit anchor.
--
-- Resolution category 'replaced' already exists (added in 0042) so
-- no enum change needed there — the close-out flow just lands on
-- that value when the ticket closes after install.
--
-- Rollback: see 0055_rollback.sql.

-- ─────────────────────────────────────────────────────────────
-- 1. Add the new enum value. alter type ... add value is not
-- transactional in older Postgres versions, so run it on its own.
-- ─────────────────────────────────────────────────────────────
alter type ticket_status_v2 add value if not exists 'awaiting_equipment';

-- ─────────────────────────────────────────────────────────────
-- 2. Replacement detail columns. All nullable — populated when
-- the team uses the new action.
-- ─────────────────────────────────────────────────────────────
alter table public.tickets
  add column if not exists replacement_model      text,
  add column if not exists replacement_supplier   text,
  add column if not exists replacement_cost       numeric(12, 2),
  add column if not exists replacement_eta        date,
  add column if not exists replacement_ordered_at timestamptz;

-- Helpful for "awaiting equipment past ETA" dashboards.
create index if not exists tickets_replacement_eta_idx
  on public.tickets (replacement_eta)
  where status = 'awaiting_equipment';

notify pgrst, 'reload schema';
