-- 0216_tp_review_log.sql
-- Monthly talent-review cadence stamp. One row per leader per month records
-- that they worked their queues (risk gaps, plan gaps, stalled goals, GM
-- exposure) for that period. Powers the "Reviewed for <Month>" nudge on the
-- Team Pipeline landing so the monthly motion is tracked, not just available.

create table if not exists tp_review_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  period       text not null,                     -- 'YYYY-MM'
  reviewed_at  timestamptz not null default now(),
  note         text
);
-- One stamp per leader per month (re-marking updates the timestamp).
create unique index if not exists tp_review_log_user_period on tp_review_log (user_id, period);

-- Service-role gatekeeper: RLS on, no policies — the function scope-checks.
alter table tp_review_log enable row level security;

notify pgrst, 'reload schema';
