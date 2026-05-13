-- supabase/migrations/0038_issue_library_dedupe.sql
--
-- Clean up duplicate rows in issue_library + add the unique constraint
-- that should have been there from the start.
--
-- Why: migration 0036's seed ended with `on conflict do nothing`, but
-- the table had no unique index on (category, asset_type, display_name)
-- for that clause to target. PostgreSQL accepted the SQL as a no-op,
-- so any re-run of 0036 silently inserted duplicate rows.
--
-- This migration:
--   1. Deletes duplicate rows (keeps one per category/asset_type/display_name).
--   2. Adds the unique constraint so future re-seeds are no-ops, not dupes.
--
-- Safe to re-run.

-- ── 1) Dedupe ───────────────────────────────────────────────
-- Keep one row per (category, asset_type, display_name). Uses id
-- ordering because gen_random_uuid()s have no natural order; any
-- single survivor is fine since the rows are otherwise identical.
delete from issue_library a
using issue_library b
where a.id > b.id
  and a.category    = b.category
  and a.asset_type  = b.asset_type
  and a.display_name = b.display_name;

-- ── 2) Unique constraint ────────────────────────────────────
-- IF NOT EXISTS isn't available for constraints; use DROP/ADD so
-- re-runs are clean.
alter table issue_library
  drop constraint if exists issue_library_unique_triple;
alter table issue_library
  add constraint issue_library_unique_triple
  unique (category, asset_type, display_name);

notify pgrst, 'reload schema';
