-- 0266_pl_review_notes.sql
-- Structured P&L preliminary-review notes: when a prelim is uploaded, the team
-- documents Root Cause + the Action Steps they'll take over the next 21 days.
-- Notes are per author, so a GM's note and their DO's note on the same store
-- never overwrite each other (each author edits only their own row). A note can
-- be store-level (line_key = '') or scoped to a specific flagged line.
-- Service-role gated: RLS on, no policies.

create table if not exists pl_review_notes (
  id            uuid        primary key default gen_random_uuid(),
  period_end    date        not null,
  store_number  text        not null,
  store_id      uuid        references stores(id) on delete set null,
  line_key      text        not null default '',   -- '' = store-level; else a budget line_key
  root_cause    text,
  action_steps  text,                               -- what they'll do over the next 21 days
  author_id     uuid        references profiles(id) on delete set null,
  author_name   text,
  author_role   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (period_end, store_number, author_id, line_key)
);

create index if not exists pl_review_notes_store_period_idx
  on pl_review_notes (store_number, period_end);

alter table pl_review_notes enable row level security;

notify pgrst, 'reload schema';
