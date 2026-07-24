-- 0257_gm_support_hours_credits.sql
-- Some stores have a GM who supports other stores and gets a set number of
-- labor hours credited to their store each week (default 20 hrs/week). SDO+
-- tag the store with the weekly hours + a start date; the credit applies each
-- day until ended. Hours convert to a dollar labor credit using the store's own
-- blended wage (see loadGmSupportCreditDates), so the store's labor cost and %
-- both drop by the credited hours. Service-role gatekeeper: RLS on, no policies.

create table if not exists gm_support_hours_credits (
  id               uuid primary key default gen_random_uuid(),
  store_number     text not null,
  weekly_hours     numeric not null default 20 check (weekly_hours > 0 and weekly_hours <= 80),
  start_date       date not null,
  end_date         date,
  note             text,
  created_by_id    uuid references profiles(id) on delete set null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists gm_support_hours_credits_store_idx
  on gm_support_hours_credits (store_number, start_date);

alter table gm_support_hours_credits enable row level security;

-- Fallback wage used only when a store has no recent labor rows to blend from.
insert into ea_settings (key, value)
values ('gm_support_default_wage', '{"amount": 13}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
