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
--
-- ╔══════════════════════════════════════════════════════════════╗
-- ║                                                              ║
-- ║   ⚠️  APPLY IN TWO PASSES — DO NOT PASTE ALL AT ONCE ⚠️     ║
-- ║                                                              ║
-- ║   Postgres rule: a new enum value must be committed before  ║
-- ║   any statement in the same transaction can USE it. Supabase ║
-- ║   wraps each SQL Editor run in a transaction, so the index  ║
-- ║   in STEP 2 cannot reference the value added in STEP 1 in   ║
-- ║   a single run — it fails with:                              ║
-- ║                                                              ║
-- ║     ERROR: 55P04: unsafe use of new value                   ║
-- ║     "awaiting_equipment" of enum type ticket_status_v2      ║
-- ║                                                              ║
-- ║   Workflow:                                                  ║
-- ║     1. Paste STEP 1 only → click RUN → wait for success     ║
-- ║     2. Paste STEP 2 only → click RUN                         ║
-- ║                                                              ║
-- ║   Once both pass, status = 'awaiting_equipment' rows can be ║
-- ║   inserted and the partial index will be used.               ║
-- ║                                                              ║
-- ╚══════════════════════════════════════════════════════════════╝


-- ═══════════════════════════════════════════════════════════════
-- STEP 1  ──  Add the new enum value. Run THIS BLOCK ALONE first.
-- ═══════════════════════════════════════════════════════════════

alter type ticket_status_v2 add value if not exists 'awaiting_equipment';


-- ═══════════════════════════════════════════════════════════════
-- STEP 2  ──  Add the replacement detail columns + partial index.
--             Run THIS BLOCK AFTER step 1 has committed.
-- ═══════════════════════════════════════════════════════════════

alter table public.tickets
  add column if not exists replacement_model      text,
  add column if not exists replacement_supplier   text,
  add column if not exists replacement_cost       numeric(12, 2),
  add column if not exists replacement_eta        date,
  add column if not exists replacement_ordered_at timestamptz;

-- Helpful for "awaiting equipment past ETA" dashboards. The partial
-- predicate references the enum value added in STEP 1, which is why
-- the two halves must run as separate transactions.
create index if not exists tickets_replacement_eta_idx
  on public.tickets (replacement_eta)
  where status = 'awaiting_equipment';

notify pgrst, 'reload schema';
