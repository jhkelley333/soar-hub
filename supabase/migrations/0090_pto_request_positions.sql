-- supabase/migrations/0090_pto_request_positions.sql
--
-- Broaden the PTO request beyond GMs.
--
-- The request now carries a `position` (GM / Associate Manager / First
-- Assistant) that drives how time off is tracked:
--   * GM               -> tracked by DAYS (existing date range + days_used),
--                         no dollar amount.
--   * Associate Manager / First Assistant (hourly team)
--                      -> tracked by HOURS, capped at 8 per day, with an
--                         hourly_wage so the dollar amount is costable, plus
--                         an hours_worked figure for the "vacation + worked
--                         hours cannot exceed 40 in a week" guardrail
--                         (enforced server-side in employee-actions.js).
--
-- Per-day hourly breakdown lives in `vacation_days` jsonb:
--   [{ "date": "2026-06-01", "hours": 8, "amount": 120.00 }, ...]
--
-- Grandfathering acquired-store vacation policies and annual-balance
-- tracking are intentionally deferred to a later migration.
--
-- Idempotent.

-- gm_name -> employee_name (the field now holds any eligible employee, not
-- just a GM). Guarded so re-running is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pto_requests' and column_name = 'gm_name'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pto_requests' and column_name = 'employee_name'
  ) then
    alter table pto_requests rename column gm_name to employee_name;
  end if;
end$$;

alter table pto_requests
  add column if not exists employee_name  text,
  add column if not exists position       text,
  add column if not exists hourly_wage    numeric(10,2),
  add column if not exists vacation_hours numeric(6,2),
  add column if not exists hours_worked   numeric(6,2),
  add column if not exists amount         numeric(10,2),
  add column if not exists vacation_days  jsonb not null default '[]';

-- days_used is GM-only now; hourly positions leave it null. Drop the NOT NULL
-- + default so it isn't forced to 0 for hourly requests.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pto_requests'
      and column_name = 'days_used' and is_nullable = 'NO'
  ) then
    alter table pto_requests alter column days_used drop not null;
    alter table pto_requests alter column days_used drop default;
  end if;
end$$;

create index if not exists pto_requests_position_idx
  on pto_requests (position);
