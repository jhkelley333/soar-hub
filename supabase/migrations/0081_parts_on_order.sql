-- supabase/migrations/0081_parts_on_order.sql
--
-- Adds the "order a part" workflow to WO2, parallel to the existing
-- "Order Replacement" (awaiting_equipment) branch but for repair PARTS
-- rather than whole-equipment replacement:
--   * New ticket status value 'parts_on_order'. Lives between the
--     decision-to-order-a-part and the part arriving / install. Reached
--     via the new "Order Parts" action on the ticket.
--   * parts_* detail columns on tickets so the team can record what was
--     ordered, from whom, at what cost, the expected arrival date, and
--     the PO number. parts_ordered_at is a timestamptz audit anchor.
--
-- Mirrors 0055_replacement_equipment.sql. NOTE: distinct from the
-- pre-existing pause_state value 'awaiting_parts' — that's an orthogonal
-- "paused while we wait" flag with no order metadata; this is a
-- first-class status with captured order details.
--
-- ╔══════════════════════════════════════════════════════════════╗
-- ║   ⚠️  APPLY IN TWO PASSES — DO NOT PASTE ALL AT ONCE ⚠️     ║
-- ║                                                              ║
-- ║   A new enum value must be committed before any statement in ║
-- ║   the same transaction can USE it. Supabase wraps each SQL   ║
-- ║   Editor run in a transaction, so STEP 2's partial index     ║
-- ║   cannot reference the value added in STEP 1 in one run —    ║
-- ║   it fails with:                                             ║
-- ║     ERROR: 55P04: unsafe use of new value                   ║
-- ║     "parts_on_order" of enum type ticket_status_v2          ║
-- ║                                                              ║
-- ║   Workflow:                                                  ║
-- ║     1. Paste STEP 1 only → click RUN → wait for success     ║
-- ║     2. Paste STEP 2 only → click RUN                         ║
-- ╚══════════════════════════════════════════════════════════════╝


-- ═══════════════════════════════════════════════════════════════
-- STEP 1  ──  Add the new enum value. Run THIS BLOCK ALONE first.
-- ═══════════════════════════════════════════════════════════════

alter type ticket_status_v2 add value if not exists 'parts_on_order';


-- ═══════════════════════════════════════════════════════════════
-- STEP 2  ──  Add the parts detail columns + partial index.
--             Run THIS BLOCK AFTER step 1 has committed.
-- ═══════════════════════════════════════════════════════════════

alter table public.tickets
  add column if not exists parts_description text,
  add column if not exists parts_supplier    text,
  add column if not exists parts_cost         numeric(12, 2),
  add column if not exists parts_eta          date,
  add column if not exists parts_po_number    text,
  add column if not exists parts_ordered_at   timestamptz;

-- Helpful for "parts on order past ETA" dashboards. The partial
-- predicate references the enum value added in STEP 1, which is why
-- the two halves must run as separate transactions.
create index if not exists tickets_parts_eta_idx
  on public.tickets (parts_eta)
  where status = 'parts_on_order';

notify pgrst, 'reload schema';
