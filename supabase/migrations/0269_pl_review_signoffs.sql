-- 0269_pl_review_signoffs.sql
-- Per-store DO sign-off on the P&L preliminary review: a DO (or above) attests
-- they have reviewed the store's notes for a period. One active sign-off per
-- (period_end, store_number) — re-signing upserts. Staleness (a note added or
-- edited after signed_at) is computed at read time, not stored.
-- Service-role gated: RLS on, no policies.

create table if not exists pl_review_signoffs (
  id             uuid        primary key default gen_random_uuid(),
  period_end     date        not null,
  store_number   text        not null,
  store_id       uuid        references stores(id) on delete set null,
  signed_by_id   uuid        references profiles(id) on delete set null,
  signed_by_name text,
  signed_by_role text,
  signed_at      timestamptz not null default now(),
  unique (period_end, store_number)
);

create index if not exists pl_review_signoffs_store_period_idx
  on pl_review_signoffs (store_number, period_end);

alter table pl_review_signoffs enable row level security;

notify pgrst, 'reload schema';
