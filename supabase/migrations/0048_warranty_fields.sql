-- supabase/migrations/0048_warranty_fields.sql
--
-- Adds vendor-level default warranty + per-ticket actual warranty
-- columns. Vendor columns are the "default offer"; ticket columns
-- get populated from the vendor's defaults when the ticket is
-- marked completed (or set manually by a DO).
--
-- Field naming follows industry convention:
--   * labor_warranty_days  — vendor workmanship guarantee
--   * parts_warranty_days  — coverage on the replacement part
--   * *_warranty_source    — 'vendor' (vendor-backed),
--                            'manufacturer' (pass-through),
--                            'none'
--
-- Days under the hood (not months) so math is trivial. UI converts
-- to "≈ N months" alongside the raw number.
--
-- Idempotent. Run on Soar Hub v2.

-- ── 1. Vendor defaults ────────────────────────────────────────
alter table vendors
  add column if not exists labor_warranty_days   int,
  add column if not exists parts_warranty_days   int,
  add column if not exists parts_warranty_source text,
  add column if not exists warranty_notes        text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vendors_parts_warranty_source_chk'
  ) then
    alter table vendors
      add constraint vendors_parts_warranty_source_chk
      check (
        parts_warranty_source is null
        or parts_warranty_source in ('vendor', 'manufacturer', 'none')
      );
  end if;
end$$;

-- ── 2. Ticket-level actuals ──────────────────────────────────
-- Populated from the vendor's defaults at completion time (or by
-- a DO via updateTicket). warranty_starts_at is usually equal to
-- the ticket's completed_at but kept as a separate column so it
-- can be "reset" (e.g., vendor returns for a callback fix and we
-- want the warranty clock to restart).
alter table tickets
  add column if not exists warranty_labor_days     int,
  add column if not exists warranty_parts_days     int,
  add column if not exists warranty_parts_source   text,
  add column if not exists warranty_starts_at      timestamptz,
  add column if not exists warranty_notes          text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_warranty_parts_source_chk'
  ) then
    alter table tickets
      add constraint tickets_warranty_parts_source_chk
      check (
        warranty_parts_source is null
        or warranty_parts_source in ('vendor', 'manufacturer', 'none')
      );
  end if;
end$$;

-- Useful for "warranties expiring soon" lookups later (not needed
-- now but cheap to add).
create index if not exists idx_tickets_warranty_starts_at
  on tickets(warranty_starts_at)
  where warranty_starts_at is not null;

notify pgrst, 'reload schema';
