-- supabase/migrations/0049_ticket_views.sql
--
-- Adds per-user "last seen" tracking for tickets so the UI can
-- show an unread-messages badge on each ticket card. Same idea
-- as a chat app's "you have 3 unread" indicator, scoped to
-- ticket_messages (both internal + vendor threads).
--
-- Convention:
--   * One row per (user_id, ticket_id). last_seen_at is updated
--     to now() every time the user expands the ticket card or
--     posts a message in its chat.
--   * Unread count for ticket T as user U = the number of
--     ticket_messages with ticket_id=T AND user_id IS DISTINCT
--     FROM U AND created_at > ticket_views.last_seen_at (or all
--     messages from other users when no row exists yet — i.e.
--     never looked at).
--
-- Idempotent. Run on Soar Hub v2.

create table if not exists ticket_views (
  user_id      uuid        not null references profiles(id) on delete cascade,
  ticket_id    uuid        not null references tickets(id)   on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);

create index if not exists idx_ticket_views_ticket
  on ticket_views(ticket_id);
create index if not exists idx_ticket_views_user
  on ticket_views(user_id);

notify pgrst, 'reload schema';
