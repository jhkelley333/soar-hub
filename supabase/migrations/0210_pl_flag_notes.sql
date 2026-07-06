-- 0210_pl_flag_notes.sql
-- Notes written against P&L walkthrough flags. The flags themselves live
-- in the monthly Google Sheet (replaced each period); notes are saved here
-- as the system of record AND pushed to the sheet's column N, so nothing
-- is lost when the sheet rolls. A flag is identified by
-- (period_end, store_number, category, item).

create table if not exists pl_flag_notes (
  id            uuid        primary key default gen_random_uuid(),
  period_end    date        not null,
  store_number  text        not null,
  category      text        not null,
  item          text        not null,
  note          text        not null,
  sheet_row     integer,
  noted_by      uuid        references profiles(id) on delete set null,
  noted_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (period_end, store_number, category, item)
);

create index if not exists pl_flag_notes_period_store_idx
  on pl_flag_notes (period_end, store_number);

-- Service-role gatekeeper pattern: RLS on, no policies.
alter table pl_flag_notes enable row level security;

notify pgrst, 'reload schema';
