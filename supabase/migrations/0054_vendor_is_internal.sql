-- supabase/migrations/0054_vendor_is_internal.sql
--
-- Adds is_internal boolean to vendors so in-house techs can live
-- alongside external vendors. Surfaced as an "Internal" chip badge
-- in the vendor typeahead. Reporting can split internal vs external
-- by group-by on this column.
--
-- Default false → existing vendor rows are treated as external,
-- which matches today's behavior.
--
-- Rollback: see 0054_rollback.sql.

alter table public.vendors
  add column if not exists is_internal boolean not null default false;

-- Helpful for "show only internal techs" filters.
create index if not exists vendors_is_internal_idx
  on public.vendors (is_internal)
  where is_internal = true;

-- Ask PostgREST to reload its schema cache so the new column is
-- visible to the API immediately.
notify pgrst, 'reload schema';
