-- supabase/migrations/0045_parts_ordered_metadata.sql
--
-- Adds two columns to tickets so we can capture who is responsible
-- for ordering parts when a ticket gets parked in pause_state =
-- 'awaiting_parts'. The vendor portal can now mark this from the
-- field without phoning the DO.
--
-- The pause_state column already exists and already supports
-- 'awaiting_parts'. These columns layer on:
--   * parts_ordered_by    'vendor' | 'customer' | null
--   * parts_ordered_notes optional free-text (part numbers, ETA,
--                        vendor's PO, etc.)
--
-- Convention:
--   * Set when vendor (or DO/GM) marks the ticket as awaiting_parts.
--   * Left populated even after the pause clears so reports like
--     "how often does the vendor order vs us?" stay queryable.
--   * Overwritten on the next parts-order event.
--
-- Idempotent. Run on Soar Hub v2.

alter table tickets
  add column if not exists parts_ordered_by    text,
  add column if not exists parts_ordered_notes text,
  add column if not exists parts_ordered_at    timestamptz;

-- Soft check: prefer app-level validation but keep the DB honest if
-- a hand-written SQL update ever runs.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_parts_ordered_by_chk'
  ) then
    alter table tickets
      add constraint tickets_parts_ordered_by_chk
      check (parts_ordered_by is null or parts_ordered_by in ('vendor', 'customer'));
  end if;
end$$;

notify pgrst, 'reload schema';
