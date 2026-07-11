-- 0236_no_gm_credits.sql
-- Stores without a GM get a weekly labor credit (default 880.00/week,
-- adjustable in ea_settings.no_gm_weekly_credit). SDO+ tag a store with a
-- reason (LOA / No GM / In Training) and a start date; the credit applies
-- each day until the record is ended. Service-role gatekeeper: RLS on, no
-- policies. Pure ASCII.

create table if not exists no_gm_credits (
  id               uuid primary key default gen_random_uuid(),
  store_number     text not null,
  reason           text not null check (reason in ('loa', 'no_gm', 'in_training')),
  start_date       date not null,
  end_date         date,
  note             text,
  created_by_id    uuid references profiles(id) on delete set null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists no_gm_credits_store_idx
  on no_gm_credits (store_number, start_date);

alter table no_gm_credits enable row level security;

insert into ea_settings (key, value)
values ('no_gm_weekly_credit', '{"amount": 880}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
