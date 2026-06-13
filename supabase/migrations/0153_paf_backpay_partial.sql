-- 0153_paf_backpay_partial.sql
-- Back pay can now be Full (the form as-is) or Partial. On a partial back pay
-- the team member already received some of what's owed — sometimes regular
-- wages, sometimes CC tips and/or declared tips. These columns record what was
-- already paid so estimated_cost nets down to the remaining amount owed.
alter table public.paf_submissions
  add column if not exists backpay_type               text          not null default 'full',  -- full | partial
  add column if not exists backpay_paid_reg           numeric(10,2) not null default 0,
  add column if not exists backpay_paid_cc_tips        numeric(10,2) not null default 0,
  add column if not exists backpay_paid_declared_tips  numeric(10,2) not null default 0;

notify pgrst, 'reload schema';
