-- 0271_pl_manual_flags.sql
-- Team-created P&L flags: while reviewing a store's statement, anyone on the
-- review can flag ANY line item with a short reason. Lightweight — one flag per
-- (period_end, store_number, line) with a single editable reason; separate from
-- the auto budget/trend flags and the owed/sign-off counts. line_key is a slug
-- of the line label so re-flagging the same line upserts.
-- Service-role gated: RLS on, no policies.

create table if not exists pl_manual_flags (
  id              uuid        primary key default gen_random_uuid(),
  period_end      date        not null,
  store_number    text        not null,
  store_id        uuid        references stores(id) on delete set null,
  line_key        text        not null,   -- slug of line_label
  line_label      text        not null,   -- the statement line as shown
  reason          text,
  flagged_by_id   uuid        references profiles(id) on delete set null,
  flagged_by_name text,
  flagged_by_role text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (period_end, store_number, line_key)
);

create index if not exists pl_manual_flags_store_period_idx
  on pl_manual_flags (store_number, period_end);

alter table pl_manual_flags enable row level security;

notify pgrst, 'reload schema';
