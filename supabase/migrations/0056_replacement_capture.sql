-- supabase/migrations/0056_replacement_capture.sql
--
-- Captures the data a future V3 Assets table will want when a
-- ticket goes the replace-rather-than-repair route. All columns are
-- nullable + optional in the UI — the team fills in what they have
-- at the time of order, more arrives once the install happens.
--
-- When V3 ships an `assets` table, the migration becomes a clean
-- INSERT INTO assets SELECT ... FROM tickets WHERE replacement_model
-- IS NOT NULL — no manual data entry, no missing records.
--
-- Rollback: see 0056_rollback.sql.

-- Asset tag / serial number. The single most important field for
-- V3 — this is how a piece of equipment becomes a row in `assets`.
-- Often a manufacturer's serial plate or a hand-applied sticker.
alter table public.tickets
  add column if not exists replacement_asset_tag text;

-- PO / order number — matches corporate AP records, enables
-- warranty claims and dispute resolution.
alter table public.tickets
  add column if not exists replacement_po_number text;

-- Warranty days from the install date. Mirrors the columns the
-- vendors table already has so the UI can pre-fill from the supplier
-- vendor row and let the user override per-purchase.
alter table public.tickets
  add column if not exists replacement_warranty_labor_days int,
  add column if not exists replacement_warranty_parts_days int;

-- Who actually backs the parts warranty — vendor passthrough or
-- direct from manufacturer. Drives who you call when something
-- breaks during the warranty window. CHECK kept loose so we can
-- add values without a migration if needed.
alter table public.tickets
  add column if not exists replacement_warranty_parts_source text;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_replacement_warranty_parts_source_chk'
  ) then
    alter table public.tickets
      add constraint tickets_replacement_warranty_parts_source_chk
      check (replacement_warranty_parts_source is null
        or replacement_warranty_parts_source in ('vendor', 'manufacturer', 'none'));
  end if;
end $$;

-- Helpful for "tickets with a warranty still in effect" dashboards.
-- Computed live in the UI for now; index lets a future scheduled
-- job sweep for expiring warranties without a full table scan.
create index if not exists tickets_replacement_asset_tag_idx
  on public.tickets (replacement_asset_tag)
  where replacement_asset_tag is not null;

notify pgrst, 'reload schema';
