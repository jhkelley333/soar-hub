-- 0144_schedule_feed_tokens.sql
-- Outbound calendar subscription. Each user gets a secret token; an
-- unauthenticated .ics endpoint (token in the URL is the credential) serves
-- that user's schedule so they can subscribe from Google / Apple / Outlook.
-- Rotating the token invalidates the old subscribe link.

create table if not exists public.schedule_feed_tokens (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  token            text not null unique,
  created_at       timestamptz not null default now(),
  last_accessed_at timestamptz
);

create index if not exists schedule_feed_tokens_token_idx
  on public.schedule_feed_tokens (token);

alter table public.schedule_feed_tokens enable row level security;
