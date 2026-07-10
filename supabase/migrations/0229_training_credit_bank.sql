-- 0229_training_credit_bank.sql
-- Training credit bank: every store gets a yearly budget (2000.00 by default)
-- that training credit requests draw down. budgets holds per-store overrides
-- (no row = the 2000 default); adjustments is the manual ledger -- positive
-- amount records use (deducts, e.g. historical backfill), negative gives
-- credit back. Service-role gatekeeper: RLS on, no policies. Pure ASCII.

create table if not exists training_credit_budgets (
  store_number  text not null,
  year          int  not null,
  budget        numeric(10,2) not null default 2000,
  updated_by    uuid references profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (store_number, year)
);

create table if not exists training_credit_adjustments (
  id            uuid primary key default gen_random_uuid(),
  store_number  text not null,
  year          int  not null,
  amount        numeric(10,2) not null,
  note          text,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists training_credit_adjustments_store_idx
  on training_credit_adjustments (store_number, year);

alter table training_credit_budgets     enable row level security;
alter table training_credit_adjustments enable row level security;

notify pgrst, 'reload schema';
