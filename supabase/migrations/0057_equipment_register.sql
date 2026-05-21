-- supabase/migrations/0057_equipment_register.sql
--
-- Lets the team capture equipment that didn't go through a WO2
-- ticket — either legacy purchases (made before SOAR) or new
-- purchases made outside the work-order workflow. Lives alongside
-- the replacement_* columns on tickets; the Replacements view in
-- the UI unions both sources.
--
-- When V3 ships an `assets` table, both sources fold in cleanly via
-- a UNION ALL — see the V3 migration sketch in PR #133.
--
-- Rollback: see 0057_rollback.sql.

create table if not exists public.equipment_register (
  id                          uuid primary key default gen_random_uuid(),
  store_id                    uuid not null references public.stores(id) on delete restrict,
  -- Denormalized for query convenience + display. Kept in sync at
  -- write time by the backend (cheap; equipment is mutated rarely).
  store_number                text not null,

  -- 'manual_legacy' = backfill of an old purchase predating SOAR
  -- 'manual_direct' = a new purchase made outside the work-order flow
  -- 'wo2_ticket' is reserved — actual ticket-sourced rows live on
  -- the tickets table (replacement_* columns), not here. We use it
  -- only as the synthesized `source` label in the union response.
  source                      text not null
                                check (source in ('manual_legacy', 'manual_direct')),

  -- Same shape as tickets.replacement_* so V3 assets migration is
  -- a simple column-mapped insert.
  asset_tag                   text,
  model                       text not null,
  supplier                    text,
  po_number                   text,
  cost                        numeric(12, 2),
  purchased_at                date,
  installed_at                date,
  warranty_labor_days         int,
  warranty_parts_days         int,
  warranty_parts_source       text
                                check (warranty_parts_source is null
                                  or warranty_parts_source in ('vendor', 'manufacturer', 'none')),
  receipt_url                 text,
  notes                       text,

  -- Provenance.
  created_by_user_id          uuid references public.profiles(id) on delete set null,
  created_by_name             text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- Soft-delete column for the future. Not exposed in the UI v1
  -- but reserved so we can hide bad entries without losing
  -- provenance / breaking V3 migration.
  archived_at                 timestamptz
);

create index if not exists equipment_register_store_idx
  on public.equipment_register (store_id)
  where archived_at is null;

create index if not exists equipment_register_store_number_idx
  on public.equipment_register (store_number)
  where archived_at is null;

create index if not exists equipment_register_asset_tag_idx
  on public.equipment_register (asset_tag)
  where asset_tag is not null and archived_at is null;

-- Maintain updated_at on row updates.
create or replace function public.equipment_register_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists equipment_register_set_updated_at_trg on public.equipment_register;
create trigger equipment_register_set_updated_at_trg
  before update on public.equipment_register
  for each row execute function public.equipment_register_set_updated_at();

notify pgrst, 'reload schema';
