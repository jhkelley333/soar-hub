-- 0225_store_portal_settings.sql
-- Key/value settings for the Store Command Center (first use: the linked
-- What's Cooking calendar URL + its cached events). Service-role gatekeeper
-- pattern: RLS on, no policies. Pure ASCII.

create table if not exists store_portal_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table store_portal_settings enable row level security;

notify pgrst, 'reload schema';
