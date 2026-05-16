-- Rollback for 0049_ticket_views.sql. Drops the entire table.
-- Any saved last_seen_at values are lost; the only impact is
-- that on next visit, every ticket may briefly show every
-- other-user message as "unread" until users open them.

drop table if exists ticket_views;

notify pgrst, 'reload schema';
