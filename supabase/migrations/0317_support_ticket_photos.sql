-- 0317_support_ticket_photos.sql
-- Support Ticket (MyHub) enhancements: an optional screenshot/photo per ticket
-- and the page the reporter was on when they filed it.
--
-- Private storage bucket; the hub-tickets function (service role) mints signed
-- upload + download URLs, so no storage.objects policies are needed. Path
-- convention: tickets/{user_id}/{timestamp}-{rand}.{ext}.

alter table public.hub_tickets add column if not exists photo_path text;
alter table public.hub_tickets add column if not exists page_path  text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-ticket-photos', 'support-ticket-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
