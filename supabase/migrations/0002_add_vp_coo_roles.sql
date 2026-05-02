-- supabase/migrations/0002_add_vp_coo_roles.sql
--
-- Phase 2a follow-on: extend the user_role hierarchy to support the VP and COO
-- approval tiers used by the Work Orders module. The hierarchy now reads
-- (low → high):
--
--   shift_manager < gm < do < sdo < rvp < vp < coo
--
-- with `admin` (system) and `payroll` (horizontal) sitting outside the
-- hierarchy as before.
--
-- Postgres enum values are append-only and ordered by insertion, so we add
-- vp and coo BEFORE admin to keep role_level() ordering correct (admin
-- continues to compare highest because it sits last in the enum).
--
-- Run order: apply this migration AFTER 0001_init.sql. Re-applying is safe
-- because the value-existence checks short-circuit.

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'user_role'::regtype
      and enumlabel = 'vp'
  ) then
    alter type user_role add value 'vp' before 'admin';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'user_role'::regtype
      and enumlabel = 'coo'
  ) then
    alter type user_role add value 'coo' before 'admin';
  end if;
end$$;

-- Refresh role_level() so the new tiers slot in cleanly between rvp (50)
-- and admin (highest). Gaps of 10 leave room for future inserts.
create or replace function role_level(r user_role)
returns int
language sql
immutable
as $$
  select case r
    when 'shift_manager' then 10
    when 'gm'            then 20
    when 'do'            then 30
    when 'sdo'           then 40
    when 'rvp'           then 50
    when 'vp'            then 60
    when 'coo'           then 70
    when 'admin'         then 100
    -- payroll is horizontal — null excludes it from hierarchy comparisons
    else null
  end;
$$;
