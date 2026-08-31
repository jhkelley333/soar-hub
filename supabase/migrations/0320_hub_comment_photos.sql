-- 0320_hub_comment_photos.sql
-- Let a support-ticket discussion comment carry a photo, like the ticket body
-- can (0317). Reuses the existing support-ticket-photos storage bucket; reads
-- and writes are mediated by the hub-tickets function (service role), so no new
-- RLS is needed on the already-locked hub_ticket_comments table.

alter table public.hub_ticket_comments add column if not exists photo_path text;

notify pgrst, 'reload schema';
