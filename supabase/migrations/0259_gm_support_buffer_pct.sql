-- 0259_gm_support_buffer_pct.sql
-- GM Support Hours can now credit a store either by fixed weekly hours OR by a
-- % buffer off labor (reduce cost + hours by that percent). Exactly one basis
-- per tag. Adds buffer_pct, makes weekly_hours optional, and swaps the old
-- hours-only check for a one-basis-or-the-other constraint.

alter table gm_support_hours_credits alter column weekly_hours drop not null;
alter table gm_support_hours_credits alter column weekly_hours drop default;
alter table gm_support_hours_credits drop constraint if exists gm_support_hours_credits_weekly_hours_check;

alter table gm_support_hours_credits add column if not exists buffer_pct numeric;

alter table gm_support_hours_credits drop constraint if exists gm_support_basis_ck;
alter table gm_support_hours_credits add constraint gm_support_basis_ck check (
  (weekly_hours is not null and weekly_hours > 0 and weekly_hours <= 80 and buffer_pct is null)
  or (buffer_pct is not null and buffer_pct > 0 and buffer_pct <= 100 and weekly_hours is null)
);

notify pgrst, 'reload schema';
