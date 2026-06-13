-- 0152_team_pipeline_settings.sql
-- Admin-configurable staffing model for Team Pipeline. A single global row
-- drives the "how many team members does a store need" calculation:
--   target (excl GM) = ceil(weekly_sales / sales_per_member)
-- weekly_sales is sourced live from the Ranker sheet; sales_per_member is the
-- dollars-of-sales-per-team-member divisor an admin can tune (default $1,200).
-- Service-role only (RLS on, no policies), like cash_settings.

create table if not exists public.tp_settings (
  id                text primary key default 'global',
  sales_per_member  int  not null default 1200,
  updated_by        uuid references public.profiles(id) on delete set null,
  updated_at        timestamptz not null default now()
);

insert into public.tp_settings (id) values ('global') on conflict (id) do nothing;

alter table public.tp_settings enable row level security;

notify pgrst, 'reload schema';
