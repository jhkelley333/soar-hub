-- 0273_gm_roster_history.sql
-- Append-only edit log for the GM roster: every change to a store's GM name or
-- status (from the inline editor or the bulk paste importer) is recorded with
-- the old + new values, who made it, and how. Powers the per-store history view.

create table if not exists gm_roster_history (
  id              uuid        primary key default gen_random_uuid(),
  store_number    text        not null,
  store_name      text,
  old_gm_name     text,
  new_gm_name     text,
  old_status      text,
  new_status      text,
  source          text        not null default 'edit',   -- 'edit' | 'import'
  changed_by      uuid        references profiles(id) on delete set null,
  changed_by_name text,
  changed_at      timestamptz not null default now()
);

create index if not exists gm_roster_history_store_idx
  on gm_roster_history (store_number, changed_at desc);

-- Service-role writes only (the gm-roster function logs edits); RLS on with no
-- policies, consistent with gm_roster itself.
alter table gm_roster_history enable row level security;

notify pgrst, 'reload schema';
