-- 0196_store_messages_expires.sql
-- Add an optional auto-expiry to store_messages. NULL = active until the
-- author removes it (current behavior, preserved); a timestamp = the message
-- drops off the board the moment it passes. The list endpoint will filter
-- on (expires_at IS NULL OR expires_at > now()). Indexed for the live-feed
-- query that's already keyed on is_active + created_at.

alter table public.store_messages
  add column if not exists expires_at timestamptz;

create index if not exists store_messages_active_live_idx
  on public.store_messages (is_active, expires_at, created_at desc);

notify pgrst, 'reload schema';
