-- 0247_training_over_bank.sql
-- Training credits over the store's yearly bank are no longer blocked at
-- submit — they're allowed but escalate from DO approval to RVP approval.
-- `over_bank` records that decision at submit time so routing stays stable.

alter table training_credit_requests
  add column if not exists over_bank boolean not null default false;

notify pgrst, 'reload schema';
