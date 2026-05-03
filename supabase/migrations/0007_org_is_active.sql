-- supabase/migrations/0007_org_is_active.sql
--
-- Phase 2c prep: soft-delete support on the org tree.
--
-- stores already has is_active (0001_init.sql). regions / markets / districts
-- did not, so deactivating a closed market or absorbed district required a
-- hard DELETE — which would cascade through districts → restrict on stores
-- and force-delete history. Adding is_active lets the Org Admin tree hide
-- closed branches without losing the historical row.
--
-- Defaults to true so existing rows stay visible. Additive, idempotent.
--
-- Note on naming: this migration uses the current `markets` table name.
-- 0009 renames markets → areas; the column added here travels with it.

alter table regions   add column if not exists is_active boolean not null default true;
alter table markets   add column if not exists is_active boolean not null default true;
alter table districts add column if not exists is_active boolean not null default true;

create index if not exists regions_is_active_idx   on regions(is_active);
create index if not exists markets_is_active_idx   on markets(is_active);
create index if not exists districts_is_active_idx on districts(is_active);
