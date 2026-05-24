-- supabase/migrations/0082_push_subscriptions.sql
--
-- Web Push subscriptions for the installed PWA. Each row is one device's
-- push endpoint (browser/OS-issued) plus the encryption keys the server
-- needs to send to it. A user can have many (phone, tablet, desktop).
--
-- Written/read only by service-role functions (push.js + chat.js), so RLS
-- is enabled with no policies — the anon/auth client can't touch it.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
