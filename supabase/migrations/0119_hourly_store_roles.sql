-- supabase/migrations/0119_hourly_store_roles.sql
--
-- Add five hourly store-level roles to the user_role hierarchy. They are
-- job titles below Shift Manager but, per product decision, all carry the
-- SAME access as shift_manager — so role_level() maps every one of them to
-- 10 (the shift_manager tier). Anything keyed off role_level() (≈22 RLS
-- policies + helpers) therefore treats them exactly like a shift manager
-- with no further change.
--
--   first_assistant_manager
--   associate_manager
--   crew_leader
--   crew_member
--   carhop
--
-- Code paths that compare the role *string* literally (e.g.
-- role === 'shift_manager') are updated in the app layer to include these
-- roles via a shared helper — see src/types/database.ts (isHourlyStoreRole)
-- and netlify/functions/_lib/roles.js.
--
-- IMPORTANT (Postgres): `ALTER TYPE ... ADD VALUE` must run OUTSIDE a
-- transaction block, and a value added in one transaction can't be used by
-- the same transaction. So this migration is split into two parts that
-- must be run as SEPARATE statements (the Supabase SQL editor runs the
-- whole script in one transaction, so run Part 1, then Part 2 — or paste
-- and run them one at a time). Each ADD VALUE is guarded with IF NOT
-- EXISTS so re-running is safe.

-- ============================================================
-- PART 1 — add the enum values. Run this first, on its own.
-- ============================================================
alter type user_role add value if not exists 'first_assistant_manager' before 'gm';
alter type user_role add value if not exists 'associate_manager'       before 'gm';
alter type user_role add value if not exists 'crew_leader'             before 'gm';
alter type user_role add value if not exists 'crew_member'             before 'gm';
alter type user_role add value if not exists 'carhop'                  before 'gm';

-- ============================================================
-- PART 2 — slot the new roles into role_level() at the shift_manager tier
-- (10). Run this AFTER Part 1 has committed. The body casts r to text so
-- it never has to validate the new labels at function-creation time.
-- ============================================================
create or replace function role_level(r user_role)
returns int
language sql
immutable
as $$
  select case r::text
    when 'shift_manager'           then 10
    when 'first_assistant_manager' then 10
    when 'associate_manager'       then 10
    when 'crew_leader'             then 10
    when 'crew_member'             then 10
    when 'carhop'                  then 10
    when 'gm'                      then 20
    when 'do'                      then 30
    when 'sdo'                     then 40
    when 'rvp'                     then 50
    when 'vp'                      then 60
    when 'coo'                     then 70
    when 'admin'                   then 100
    -- payroll is horizontal — null excludes it from hierarchy comparisons
    else null
  end;
$$;
