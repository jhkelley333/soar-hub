-- 0278_corporate_training_credits.sql
-- Corporate training-class labor credit. A batch is uploaded via CSV (the list
-- of stores with attendees in the class), then applied to a chosen fiscal week
-- and specific days at a per-day dollar rate (default $176/day, adjustable). The
-- credit lands on the Labor v2 chart like the other labor credits (training /
-- GM PTO / no-GM / GM support) via loadLaborCredits. One row per uploaded batch;
-- `dates` are the calendar days it applies to and `stores` is [{store_number,
-- count}] so a store with N attendees is credited N x rate per day.

create table if not exists corporate_training_credits (
  id               uuid primary key default gen_random_uuid(),
  label            text,
  daily_amount     numeric not null default 176,
  dates            text[]  not null,
  stores           jsonb   not null,
  created_by_id    uuid references profiles(id) on delete set null,
  created_by_email text,
  created_at       timestamptz not null default now()
);

-- Service-role gatekeeper: RLS on, no policies (same as the other credit tables).
alter table corporate_training_credits enable row level security;

notify pgrst, 'reload schema';
