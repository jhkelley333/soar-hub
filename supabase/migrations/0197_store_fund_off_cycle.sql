-- 0197_store_fund_off_cycle.sql
-- Add an off-cycle flag to store_fund_validations so a surprise audit can be
-- recorded without erasing the required monthly validation. The "validated
-- this period" status and the locked Validate button continue to look at
-- non-off-cycle rows only; off-cycle counts are tracked in history and shown
-- as the most recent count where appropriate.

alter table public.store_fund_validations
  add column if not exists is_off_cycle boolean not null default false;

-- Helps the list query split required vs. off-cycle quickly.
create index if not exists store_fund_validations_cycle_idx
  on public.store_fund_validations (store_id, is_off_cycle, validated_at desc);

notify pgrst, 'reload schema';
