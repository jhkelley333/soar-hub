-- 0230_ea_settings_gm_pto_credit.sql
-- Employee Actions settings + the GM PTO labor credit rate. A GM on approved
-- PTO credits their store's labor chart just like training credit does:
-- 176.00 per selected PTO day (880.00 per 5-day week). Stored here so the
-- rate is adjustable without a deploy. Service-role gatekeeper: RLS on, no
-- policies. Pure ASCII.

create table if not exists ea_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table ea_settings enable row level security;

insert into ea_settings (key, value)
values ('gm_pto_daily_credit', '{"amount": 176}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
